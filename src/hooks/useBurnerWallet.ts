'use client';

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useAccount, useSignMessage } from 'wagmi';
import { RPC_URL, CONTRACT_ADDRESS } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';

// Cached provider - created once
let cachedProvider: ethers.JsonRpcProvider | null = null;
function getProvider(): ethers.JsonRpcProvider {
  if (!cachedProvider) {
    cachedProvider = new ethers.JsonRpcProvider(RPC_URL);
  }
  return cachedProvider;
}

// Cached wallet and contract for fast taps - created once per burner
let cachedWallet: ethers.Wallet | null = null;
let cachedContract: ethers.Contract | null = null;
let cachedBurnerKey: string | null = null;

// Nonce management for parallel transactions
let currentNonce: number | null = null;

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
  const { signMessageAsync } = useSignMessage();

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

  // Check if burner exists on backend
  // SECURITY: Private keys are now server-side only - client cannot decrypt
  // This function only checks if burner exists and returns the address
  // The actual key is stored locally and used from localStorage
  const restoreBurnerFromBackend = async (
    wallet: string, 
    keys: { burnerKey: string; burnerAddress: string }
  ): Promise<{ address: string; privateKey: string } | null> => {
    try {
      // Check if burner exists on backend (returns only address, not encrypted key)
      const res = await fetch(`/api/get-burner?wallet=${wallet}`);
      
      if (!res.ok) {
        return null;
      }
      
      const data = await res.json();
      
      if (!data.exists) {
        return null;
      }
      
      // Burner exists on backend but private key is encrypted server-side
      // We can only use it if we have the key in localStorage
      // Otherwise, user needs to create a new burner (via new deposit)
      console.log('Burner exists on backend:', data.burnerAddress);
      
      // Check if we have the key locally
      const localKey = localStorage.getItem(keys.burnerKey);
      if (localKey) {
        // Validate the local key matches the backend address
        try {
          const wallet_obj = new ethers.Wallet(localKey);
          if (wallet_obj.address.toLowerCase() === data.burnerAddress.toLowerCase()) {
            localStorage.setItem(keys.burnerAddress, data.burnerAddress);
            return {
              address: data.burnerAddress,
              privateKey: localKey,
            };
          }
        } catch {
          // Invalid local key, clear it
          localStorage.removeItem(keys.burnerKey);
          localStorage.removeItem(keys.burnerAddress);
        }
      }
      
      // No valid local key - user needs to create new burner
      // This can happen if user clears browser data
      console.log('No local key available for burner restoration');
      return null;
    } catch (err) {
      console.error('Error checking burner on backend:', err);
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
  // OPTIMIZED: No wallet creation for validation - just return stored data
  const getBurner = useCallback((): { address: string; privateKey: string } | null => {
    if (typeof window === 'undefined') return null;
    if (!mainWallet) return null;

    const keys = getStorageKeys(mainWallet);
    const privateKey = localStorage.getItem(keys.burnerKey);
    const address = localStorage.getItem(keys.burnerAddress);
    if (!privateKey || !address) return null;

    // Return stored data directly - validation happens when wallet is created in sendTap
    return {
      address: address,
      privateKey: privateKey,
    };
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
  // SECURITY: Signs message to prove ownership, server encrypts the key
  const registerBurnerWithBackend = useCallback(async (burnerAddr: string, privateKey: string): Promise<void> => {
    if (!mainWallet) return;
    
    try {
      const timestamp = Date.now().toString();
      const message = `Register burner ${burnerAddr} for ${mainWallet} at ${timestamp}`;
      
      // Sign message to prove ownership of mainWallet
      const signature = await signMessageAsync({ message });
      
      const response = await fetch('/api/register-burner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mainWallet: mainWallet,
          burnerWallet: burnerAddr,
          privateKey: privateKey, // Server will encrypt this
          signature,
          timestamp,
        }),
      });
      
      if (!response.ok) {
        const data = await response.json();
        console.error('Failed to register burner:', data.error);
      }
    } catch (err) {
      console.error('Failed to register burner with backend:', err);
    }
  }, [mainWallet, signMessageAsync]);

  // Send tap transaction via burner wallet
  // OPTIMIZED: Cached wallet/contract + manual nonce for parallel txs (1 tap/sec)
  const sendTap = useCallback(async (): Promise<ethers.TransactionResponse> => {
    const burnerData = getBurner();
    if (!burnerData) {
      throw new Error('No burner wallet found. Please complete deposit first.');
    }

    const provider = getProvider();

    // Cache wallet/contract (created once per burner)
    if (cachedBurnerKey !== burnerData.privateKey || !cachedWallet || !cachedContract) {
      cachedWallet = new ethers.Wallet(burnerData.privateKey, provider);
      cachedContract = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, cachedWallet);
      cachedBurnerKey = burnerData.privateKey;
      currentNonce = null;
    }

    // Get nonce - fetch once from RPC, then increment locally
    if (currentNonce === null) {
      currentNonce = await provider.getTransactionCount(cachedWallet.address, 'pending');
    }

    // Use current nonce and increment for next tx
    const nonce = currentNonce++;

    // Single RPC call with explicit nonce
    const tx = await cachedContract.tap({ nonce });
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
