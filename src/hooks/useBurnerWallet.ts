'use client';

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useAccount } from 'wagmi';
import { RPC_URL, CONTRACT_ADDRESS } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';
import { encryptKey, decryptKey } from '@/lib/encryption';

// Cached provider - created once
let cachedProvider: ethers.JsonRpcProvider | null = null;
function getProvider(): ethers.JsonRpcProvider {
  if (!cachedProvider) {
    cachedProvider = new ethers.JsonRpcProvider(RPC_URL);
  }
  return cachedProvider;
}

// Track which wallets we've checked to prevent duplicate API calls
const checkedWallets = new Set<string>();

// Custom event for burner creation (cross-component sync)
const BURNER_CREATED_EVENT = 'basion:burner-created';

// Helper to get wallet-specific storage keys
function getStorageKeys(walletAddress: string) {
  const normalized = walletAddress.toLowerCase();
  return {
    burnerKey: `basion_burner_key_${normalized}`,
    burnerAddress: `basion_burner_address_${normalized}`,
  };
}

export function useBurnerWallet() {
  const [burnerAddress, setBurnerAddress] = useState<string | null>(null);
  const [hasBurner, setHasBurner] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const { address: mainWallet } = useAccount();

  // Listen for burner creation events from other components
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const handleBurnerCreated = () => {
      setRefreshTrigger(prev => prev + 1);
    };
    
    window.addEventListener(BURNER_CREATED_EVENT, handleBurnerCreated);
    return () => window.removeEventListener(BURNER_CREATED_EVENT, handleBurnerCreated);
  }, []);

  // Load or restore burner for current wallet
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Reset state when no wallet connected
    if (!mainWallet) {
      setBurnerAddress(null);
      setHasBurner(false);
      return;
    }

    const keys = getStorageKeys(mainWallet);
    
    // Check localStorage first
    const localKey = localStorage.getItem(keys.burnerKey);
    const localAddress = localStorage.getItem(keys.burnerAddress);
    
    if (localKey && localAddress) {
      // Burner exists locally
      setBurnerAddress(localAddress);
      setHasBurner(true);
      return;
    }

    // No local burner - try to restore from Supabase
    // Only check once per wallet per session (unless refreshTrigger changed)
    if (checkedWallets.has(mainWallet.toLowerCase()) && refreshTrigger === 0) {
      setBurnerAddress(null);
      setHasBurner(false);
      return;
    }

    // Mark as checked to prevent duplicate API calls
    checkedWallets.add(mainWallet.toLowerCase());
    
    // Try to restore from backend
    setIsRestoring(true);
    restoreBurnerFromBackend(mainWallet, keys)
      .then(restored => {
        if (restored) {
          setBurnerAddress(restored.address);
          setHasBurner(true);
        } else {
          setBurnerAddress(null);
          setHasBurner(false);
        }
      })
      .catch(err => {
        console.error('Failed to restore burner:', err);
        setBurnerAddress(null);
        setHasBurner(false);
      })
      .finally(() => {
        setIsRestoring(false);
      });
  }, [mainWallet, refreshTrigger]);

  // Restore burner from Supabase
  // Note: Full restore requires signature from main wallet for security
  // Without signature, we only get burner address (not the encrypted key)
  const restoreBurnerFromBackend = async (
    wallet: string, 
    keys: { burnerKey: string; burnerAddress: string }
  ): Promise<{ address: string; privateKey: string } | null> => {
    try {
      // First, check if burner exists (without signature - just address)
      const res = await fetch(`/api/get-burner?wallet=${wallet}`);
      
      if (!res.ok) {
        return null;
      }
      
      const data = await res.json();
      
      if (!data.exists) {
        return null;
      }
      
      // If no encryptedKey returned (security: signature required for full restore)
      // Just save the address for display purposes
      if (!data.encryptedKey) {
        // Burner exists on backend but we can't restore without signature
        // User will need to create new burner or sign to restore
        console.log('Burner exists but encrypted key requires signature to restore');
        return null;
      }
      
      // Decrypt the key
      const privateKey = decryptKey(data.encryptedKey);
      
      // Validate the key by creating a wallet
      const wallet_obj = new ethers.Wallet(privateKey);
      
      // Verify address matches
      if (wallet_obj.address.toLowerCase() !== data.burnerAddress.toLowerCase()) {
        console.error('Burner address mismatch after decryption');
        return null;
      }
      
      // Save to localStorage
      localStorage.setItem(keys.burnerKey, privateKey);
      localStorage.setItem(keys.burnerAddress, data.burnerAddress);
      
      console.log('Burner wallet restored from backend');
      
      return {
        address: data.burnerAddress,
        privateKey: privateKey,
      };
    } catch (err) {
      console.error('Error restoring burner from backend:', err);
      return null;
    }
  };

  // Create new burner wallet for current mainWallet
  // Returns object with address and privateKey for compatibility
  const createBurner = useCallback((): { address: string; privateKey: string } => {
    if (typeof window === 'undefined') {
      throw new Error('Cannot create burner wallet on server');
    }
    if (!mainWallet) {
      throw new Error('No wallet connected');
    }

    const wallet = ethers.Wallet.createRandom();
    const keys = getStorageKeys(mainWallet);

    // Save to wallet-specific localStorage keys
    localStorage.setItem(keys.burnerKey, wallet.privateKey);
    localStorage.setItem(keys.burnerAddress, wallet.address);

    setBurnerAddress(wallet.address);
    setHasBurner(true);

    // Dispatch event to notify other components
    window.dispatchEvent(new Event(BURNER_CREATED_EVENT));

    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
    };
  }, [mainWallet]);

  // Get existing burner wallet for current mainWallet
  const getBurner = useCallback((): { address: string; privateKey: string } | null => {
    if (typeof window === 'undefined') return null;
    if (!mainWallet) return null;

    const keys = getStorageKeys(mainWallet);
    const privateKey = localStorage.getItem(keys.burnerKey);
    const address = localStorage.getItem(keys.burnerAddress);
    if (!privateKey || !address) return null;

    try {
      // Validate key by creating wallet
      const wallet = new ethers.Wallet(privateKey);
      return {
        address: wallet.address,
        privateKey: privateKey,
      };
    } catch (err) {
      console.error('Invalid burner key in localStorage:', err);
      localStorage.removeItem(keys.burnerKey);
      localStorage.removeItem(keys.burnerAddress);
      setBurnerAddress(null);
      setHasBurner(false);
      return null;
    }
  }, [mainWallet]);

  // Get burner address without loading full wallet
  const getBurnerAddress = useCallback((): string | null => {
    if (typeof window === 'undefined') return null;
    if (!mainWallet) return null;
    
    const keys = getStorageKeys(mainWallet);
    return localStorage.getItem(keys.burnerAddress);
  }, [mainWallet]);

  // Clear burner wallet for current mainWallet
  const clearBurner = useCallback((): void => {
    if (typeof window === 'undefined') return;
    if (!mainWallet) return;

    const keys = getStorageKeys(mainWallet);
    localStorage.removeItem(keys.burnerKey);
    localStorage.removeItem(keys.burnerAddress);

    setBurnerAddress(null);
    setHasBurner(false);
  }, [mainWallet]);

  // Register burner with backend (called after creating new burner)
  const registerBurnerWithBackend = useCallback(async (burnerAddr: string, privateKey: string): Promise<void> => {
    if (!mainWallet) return;
    
    try {
      const encrypted = encryptKey(privateKey);
      
      await fetch('/api/register-burner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mainWallet: mainWallet,
          burnerWallet: burnerAddr,
          encryptedKey: encrypted,
        }),
      });
    } catch (err) {
      console.error('Failed to register burner with backend:', err);
    }
  }, [mainWallet]);

  // Send tap transaction via burner wallet
  const sendTap = useCallback(async (): Promise<ethers.TransactionResponse> => {
    const burnerData = getBurner();
    if (!burnerData) {
      throw new Error('No burner wallet found. Please complete deposit first.');
    }

    const provider = getProvider();
    
    const balance = await provider.getBalance(burnerData.address);
    const feeData = await provider.getFeeData();
    const estimatedGas = 50000n;
    const gasCost = estimatedGas * (feeData.gasPrice || 0n);
    
    if (balance < gasCost) {
      throw new Error(`Insufficient gas. Balance: ${ethers.formatEther(balance)} ETH, need: ${ethers.formatEther(gasCost)} ETH`);
    }

    // Create wallet from private key and connect to provider
    const wallet = new ethers.Wallet(burnerData.privateKey, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, wallet);

    const tx = await contract.tap();
    return tx;
  }, [getBurner]);

  // Send multiple taps at once (for batch mode)
  const sendTapMultiple = useCallback(
    async (count: number): Promise<ethers.TransactionResponse> => {
      if (count <= 0 || count > 100) {
        throw new Error('Tap count must be between 1 and 100');
      }

      const burnerData = getBurner();
      if (!burnerData) {
        throw new Error('No burner wallet found. Please complete deposit first.');
      }

      const provider = getProvider();
      
      const balance = await provider.getBalance(burnerData.address);
      const feeData = await provider.getFeeData();
      const estimatedGas = BigInt(50000 + count * 5000);
      const gasCost = estimatedGas * (feeData.gasPrice || 0n);
      
      if (balance < gasCost) {
        throw new Error(`Insufficient gas for ${count} taps`);
      }

      // Create wallet from private key and connect to provider
      const wallet = new ethers.Wallet(burnerData.privateKey, provider);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, wallet);

      const tx = await contract.batchTap(count);
      return tx;
    },
    [getBurner]
  );

  // Get ETH balance on burner wallet
  const getBurnerBalance = useCallback(async (): Promise<string> => {
    const address = getBurnerAddress();
    if (!address) return '0';

    try {
      const provider = getProvider();
      const balance = await provider.getBalance(address);
      return ethers.formatEther(balance);
    } catch (err) {
      console.error('Failed to get burner balance:', err);
      return '0';
    }
  }, [getBurnerAddress]);

  return {
    burnerAddress,
    hasBurner,
    isRestoring,
    createBurner,
    getBurner,
    getBurnerAddress,
    clearBurner,
    registerBurnerWithBackend,
    sendTap,
    sendTapMultiple,
    getBurnerBalance,
  };
}
