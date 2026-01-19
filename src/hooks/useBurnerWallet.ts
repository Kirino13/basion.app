'use client';

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useAccount } from 'wagmi';
import { RPC_URL, CONTRACT_ADDRESS } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';
import { encryptKey } from '@/lib/encryption';

// Cached provider - created once
let cachedProvider: ethers.JsonRpcProvider | null = null;
function getProvider(): ethers.JsonRpcProvider {
  if (!cachedProvider) {
    cachedProvider = new ethers.JsonRpcProvider(RPC_URL);
  }
  return cachedProvider;
}

// Track which wallets we've synced to prevent duplicates
const syncedWallets = new Set<string>();

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
  const { address: mainWallet } = useAccount();

  // Load burner for current wallet when wallet changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Reset state when no wallet connected
    if (!mainWallet) {
      setBurnerAddress(null);
      setHasBurner(false);
      return;
    }

    // Get wallet-specific storage keys
    const keys = getStorageKeys(mainWallet);
    const address = localStorage.getItem(keys.burnerAddress);
    const key = localStorage.getItem(keys.burnerKey);
    
    setBurnerAddress(address);
    setHasBurner(!!key && !!address);
    
    // Sync to backend if not already synced for this wallet
    if (address && key && !syncedWallets.has(mainWallet.toLowerCase())) {
      syncedWallets.add(mainWallet.toLowerCase());
      syncBurnerToBackend(address, key, mainWallet);
    }
  }, [mainWallet]);

  // Sync burner with backend
  const syncBurnerToBackend = async (burnerAddr: string, privateKey: string, mainAddr: string) => {
    try {
      const encryptedKey = encryptKey(privateKey);
      
      await fetch('/api/register-burner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mainWallet: mainAddr,
          burnerWallet: burnerAddr,
          encryptedKey,
        }),
      });
    } catch (err) {
      // Remove from synced set so we retry next time
      syncedWallets.delete(mainAddr.toLowerCase());
      console.error('Failed to sync burner to backend:', err);
    }
  };

  // Create new burner wallet for current mainWallet
  const createBurner = useCallback((): ethers.HDNodeWallet => {
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

    return wallet;
  }, [mainWallet]);

  // Get existing burner wallet for current mainWallet
  const getBurner = useCallback((): ethers.Wallet | null => {
    if (typeof window === 'undefined') return null;
    if (!mainWallet) return null;

    const keys = getStorageKeys(mainWallet);
    const privateKey = localStorage.getItem(keys.burnerKey);
    if (!privateKey) return null;

    try {
      return new ethers.Wallet(privateKey);
    } catch (err) {
      console.error('Invalid burner key in localStorage:', err);
      // Remove invalid key
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

  // Send tap transaction via burner wallet
  const sendTap = useCallback(async (): Promise<ethers.TransactionResponse> => {
    const burner = getBurner();
    if (!burner) {
      throw new Error('No burner wallet found. Please complete deposit first.');
    }

    const provider = getProvider();
    
    // Check balance before sending
    const balance = await provider.getBalance(burner.address);
    const feeData = await provider.getFeeData();
    const estimatedGas = 50000n;
    const gasCost = estimatedGas * (feeData.gasPrice || 0n);
    
    if (balance < gasCost) {
      throw new Error(`Insufficient gas. Balance: ${ethers.formatEther(balance)} ETH, need: ${ethers.formatEther(gasCost)} ETH`);
    }

    const signer = burner.connect(provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, signer);

    const tx = await contract.tap();
    return tx;
  }, [getBurner]);

  // Send multiple taps at once
  const sendTapMultiple = useCallback(
    async (count: number): Promise<ethers.TransactionResponse> => {
      if (count <= 0 || count > 100) {
        throw new Error('Tap count must be between 1 and 100');
      }

      const burner = getBurner();
      if (!burner) {
        throw new Error('No burner wallet found. Please complete deposit first.');
      }

      const provider = getProvider();
      
      const balance = await provider.getBalance(burner.address);
      const feeData = await provider.getFeeData();
      const estimatedGas = BigInt(50000 + count * 5000);
      const gasCost = estimatedGas * (feeData.gasPrice || 0n);
      
      if (balance < gasCost) {
        throw new Error(`Insufficient gas for ${count} taps`);
      }

      const signer = burner.connect(provider);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, signer);

      const tx = await contract.tapMultiple(count);
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
    createBurner,
    getBurner,
    getBurnerAddress,
    clearBurner,
    sendTap,
    sendTapMultiple,
    getBurnerBalance,
  };
}
