'use client';

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useAccount } from 'wagmi';
import { STORAGE_KEYS, RPC_URL, CONTRACT_ADDRESS } from '@/config/constants';
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

// Flag to prevent double sync
let hasSyncedBurner = false;

// Store the last known wallet to detect changes
const LAST_WALLET_KEY = 'basion_last_wallet';

export function useBurnerWallet() {
  const [burnerAddress, setBurnerAddress] = useState<string | null>(null);
  const [hasBurner, setHasBurner] = useState(false);
  const { address: mainWallet } = useAccount();
  
  // Detect wallet changes and protect against abuse
  useEffect(() => {
    if (typeof window === 'undefined' || !mainWallet) return;
    
    const lastWallet = localStorage.getItem(LAST_WALLET_KEY);
    
    // If there was a previous wallet and it's different, this is a wallet switch
    if (lastWallet && lastWallet.toLowerCase() !== mainWallet.toLowerCase()) {
      // Clear burner data to prevent abuse - new wallet needs its own burner
      console.log('Wallet changed. Clearing local burner data for security.');
      localStorage.removeItem(STORAGE_KEYS.burnerKey);
      localStorage.removeItem(STORAGE_KEYS.burnerAddress);
      setBurnerAddress(null);
      setHasBurner(false);
      hasSyncedBurner = false;
    }
    
    // Update last known wallet
    localStorage.setItem(LAST_WALLET_KEY, mainWallet);
  }, [mainWallet]);

  // Sync burner with backend (once per session)
  const syncBurnerToBackend = useCallback(async (burnerAddr: string, privateKey: string, mainAddr: string) => {
    if (hasSyncedBurner) return; // Prevent re-sync
    hasSyncedBurner = true;
    
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
      hasSyncedBurner = false; // Reset flag on error for retry
      console.error('Failed to sync burner to backend:', err);
    }
  }, []);

  // Check existing burner on mount and sync
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const address = localStorage.getItem(STORAGE_KEYS.burnerAddress);
      const key = localStorage.getItem(STORAGE_KEYS.burnerKey);
      setBurnerAddress(address);
      setHasBurner(!!key && !!address);
      
      // If burner exists and mainWallet present - sync with backend
      if (address && key && mainWallet) {
        syncBurnerToBackend(address, key, mainWallet);
      }
    }
  }, [mainWallet, syncBurnerToBackend]);

  // Create new burner wallet
  // Returns HDNodeWallet (ethers v6: createRandom returns HDNodeWallet)
  const createBurner = useCallback((): ethers.HDNodeWallet => {
    if (typeof window === 'undefined') {
      throw new Error('Cannot create burner wallet on server');
    }

    const wallet = ethers.Wallet.createRandom();

    // Save to localStorage
    localStorage.setItem(STORAGE_KEYS.burnerKey, wallet.privateKey);
    localStorage.setItem(STORAGE_KEYS.burnerAddress, wallet.address);

    setBurnerAddress(wallet.address);
    setHasBurner(true);

    return wallet;
  }, []);

  // Get existing burner wallet
  const getBurner = useCallback((): ethers.Wallet | null => {
    if (typeof window === 'undefined') return null;

    const privateKey = localStorage.getItem(STORAGE_KEYS.burnerKey);
    if (!privateKey) return null;

    try {
      return new ethers.Wallet(privateKey);
    } catch (err) {
      console.error('Invalid burner key in localStorage:', err);
      // Remove invalid key
      localStorage.removeItem(STORAGE_KEYS.burnerKey);
      localStorage.removeItem(STORAGE_KEYS.burnerAddress);
      setBurnerAddress(null);
      setHasBurner(false);
      return null;
    }
  }, []);

  // Get burner address without loading full wallet
  const getBurnerAddress = useCallback((): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEYS.burnerAddress);
  }, []);

  // Clear burner wallet (on logout/reset)
  const clearBurner = useCallback((): void => {
    if (typeof window === 'undefined') return;

    localStorage.removeItem(STORAGE_KEYS.burnerKey);
    localStorage.removeItem(STORAGE_KEYS.burnerAddress);

    setBurnerAddress(null);
    setHasBurner(false);
  }, []);

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
    const estimatedGas = 50000n; // Approximate gas estimate for tap()
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
      
      // Check balance
      const balance = await provider.getBalance(burner.address);
      const feeData = await provider.getFeeData();
      const estimatedGas = BigInt(50000 + count * 5000); // More gas for multi-tap
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
