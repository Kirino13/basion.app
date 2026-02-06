'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { useAccount, useSignMessage } from 'wagmi';
import { RPC_URL, CONTRACT_ADDRESS, MAX_GAS_GWEI } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';

// Safe localStorage helpers (handle private browsing mode, etc.)
const safeLocalStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): boolean => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      console.warn('localStorage.setItem failed (private mode?)');
      return false;
    }
  },
  removeItem: (key: string): boolean => {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },
};

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

// Nonce and gas management for parallel transactions
let currentNonce: number | null = null;
let cachedGasPrice: bigint | null = null;
let gasPriceLastFetch: number = 0;
const GAS_PRICE_CACHE_MS = 30000; // Cache gas price for 30 seconds
const FIXED_GAS_LIMIT = 100000n; // Fixed gas limit for tap() - we know it uses ~50k
const MAX_GAS_PRICE_WEI = BigInt(Math.round(MAX_GAS_GWEI * 1e9)); // 0.005 gwei -> 5,000,000 wei

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
  // Per-hook-instance caches (avoid cross-component state desync)
  const checkedWalletsRef = useRef<Set<string>>(new Set());
  const checkedServerSyncStatusRef = useRef<Set<string>>(new Set());
  // Protect against races between initial /api/get-burner check and a manual Sync.
  // If Sync succeeds, we bump this token so any older in-flight check can't re-show the banner.
  const serverSyncCheckTokenRef = useRef(0);

  const [burnerAddress, setBurnerAddress] = useState<string | null>(null);
  const [hasBurner, setHasBurner] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  // NEW: State for cross-device restore
  const [needsRestore, setNeedsRestore] = useState(false);
  const [serverBurnerAddress, setServerBurnerAddress] = useState<string | null>(null);
  const [isRestoringFromServer, setIsRestoringFromServer] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  // NEW: state for syncing an existing local burner to server
  const [needsServerSync, setNeedsServerSync] = useState(false);
  const [isSyncingToServer, setIsSyncingToServer] = useState(false);
  const [serverSyncError, setServerSyncError] = useState<string | null>(null);
  
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
      setNeedsRestore(false);
      setServerBurnerAddress(null);
      setRestoreError(null);
      setNeedsServerSync(false);
      setIsSyncingToServer(false);
      setServerSyncError(null);
      return;
    }

    const keys = getStorageKeys(mainWallet);
    const normalizedMain = mainWallet.toLowerCase();
    const serverSyncedMarkerKey = `basion_burner_server_synced_${normalizedMain}`;
    
    // Check localStorage first
    let localKey = safeLocalStorage.getItem(keys.burnerKey);
    let localAddress = safeLocalStorage.getItem(keys.burnerAddress);

    // If key exists but address missing, derive address from key (older states / partial writes).
    if (localKey && !localAddress) {
      try {
        const walletObj = new ethers.Wallet(localKey);
        localAddress = walletObj.address;
        safeLocalStorage.setItem(keys.burnerAddress, localAddress);
      } catch {
        // Invalid local key, clear it
        safeLocalStorage.removeItem(keys.burnerKey);
        safeLocalStorage.removeItem(keys.burnerAddress);
        localKey = null;
        localAddress = null;
      }
    }

    // Backward-compat: migrate legacy (non wallet-specific) storage keys.
    // Older versions stored burner under:
    // - basion_burner_key
    // - basion_burner_address
    // If present, copy to wallet-specific keys for the connected main wallet.
    if (!localKey) {
      const legacyKey = safeLocalStorage.getItem('basion_burner_key');
      const legacyAddress = safeLocalStorage.getItem('basion_burner_address');
      if (legacyKey) {
        try {
          const walletObj = new ethers.Wallet(legacyKey);
          const addr = legacyAddress || walletObj.address;
          safeLocalStorage.setItem(keys.burnerKey, legacyKey);
          safeLocalStorage.setItem(keys.burnerAddress, addr);
          safeLocalStorage.removeItem('basion_burner_key');
          safeLocalStorage.removeItem('basion_burner_address');
          localKey = legacyKey;
          localAddress = addr;
        } catch {
          // If legacy key is invalid, clear it to avoid repeated failures.
          safeLocalStorage.removeItem('basion_burner_key');
          safeLocalStorage.removeItem('basion_burner_address');
        }
      }
    }
    
    if (localKey && localAddress) {
      // Burner exists locally - all good
      setBurnerAddress(localAddress);
      setHasBurner(true);
      setNeedsRestore(false);
      setServerBurnerAddress(null);
      setRestoreError(null);

      // Ensure the burner is also stored on server for cross-device restore.
      // Best-effort: never block taps if this check fails.
      const hasSyncedMarker = safeLocalStorage.getItem(serverSyncedMarkerKey) === '1';
      if (hasSyncedMarker) {
        // Optimistically hide banner, but still verify server state once per session.
        setNeedsServerSync(false);
      }

      if (checkedServerSyncStatusRef.current.has(normalizedMain) && refreshTrigger === 0) {
        return;
      }
      checkedServerSyncStatusRef.current.add(normalizedMain);

      (async () => {
        const token = ++serverSyncCheckTokenRef.current;
        try {
          const res = await fetch(`/api/get-burner?wallet=${mainWallet}`);
          if (!res.ok) return;
          const data = await res.json();
          // Ignore stale results if a newer check/sync happened.
          if (token !== serverSyncCheckTokenRef.current) return;
          if (data?.exists && typeof data.burnerAddress === 'string') {
            const matches = data.burnerAddress.toLowerCase() === localAddress.toLowerCase();
            if (matches) {
              safeLocalStorage.setItem(serverSyncedMarkerKey, '1');
              setNeedsServerSync(false);
            } else {
              // Server has a different burner (or stale record) -> require manual sync
              safeLocalStorage.removeItem(serverSyncedMarkerKey);
              setNeedsServerSync(true);
            }
            return;
          }
          // No burner on server -> require manual sync
          safeLocalStorage.removeItem(serverSyncedMarkerKey);
          setNeedsServerSync(true);
        } catch {
          // ignore
        }
      })();
      return;
    }

    // No local burner - try to restore from Supabase
    // Only check once per wallet per session (unless refreshTrigger changed)
    if (checkedWalletsRef.current.has(mainWallet.toLowerCase()) && refreshTrigger === 0) {
      // Already checked, maintain current state
      return;
    }

    // Mark as checked to prevent duplicate API calls
    checkedWalletsRef.current.add(mainWallet.toLowerCase());
    
    // Try to restore from backend
    setIsRestoring(true);
    checkBurnerOnBackend(mainWallet, keys)
      .then(result => {
        if (result.hasLocal) {
          // Found valid local key
          setBurnerAddress(result.address!);
          setHasBurner(true);
          setNeedsRestore(false);
          setServerBurnerAddress(null);
        } else if (result.existsOnServer) {
          // Burner exists on server but no local key - needs restore
          setBurnerAddress(null);
          setHasBurner(false);
          setNeedsRestore(true);
          setServerBurnerAddress(result.address!);
        } else {
          // No burner anywhere - new user
          setBurnerAddress(null);
          setHasBurner(false);
          setNeedsRestore(false);
          setServerBurnerAddress(null);
        }
      })
      .catch(err => {
        console.error('Failed to check burner:', err);
        setBurnerAddress(null);
        setHasBurner(false);
        setNeedsRestore(false);
      })
      .finally(() => {
        setIsRestoring(false);
      });
  }, [mainWallet, refreshTrigger]);

  // Check if burner exists on backend and/or locally
  // Returns: { hasLocal, existsOnServer, address }
  const checkBurnerOnBackend = async (
    wallet: string, 
    keys: { burnerKey: string; burnerAddress: string }
  ): Promise<{ hasLocal: boolean; existsOnServer: boolean; address: string | null }> => {
    try {
      // Check if burner exists on backend
      const res = await fetch(`/api/get-burner?wallet=${wallet}`);
      
      if (!res.ok) {
        return { hasLocal: false, existsOnServer: false, address: null };
      }
      
      const data = await res.json();
      
      if (!data.exists) {
        return { hasLocal: false, existsOnServer: false, address: null };
      }
      
      // Burner exists on server - check if we have local key
      const localKey = safeLocalStorage.getItem(keys.burnerKey);
      if (localKey) {
        // Validate the local key matches the backend address
        try {
          const wallet_obj = new ethers.Wallet(localKey);
          if (wallet_obj.address.toLowerCase() === data.burnerAddress.toLowerCase()) {
            safeLocalStorage.setItem(keys.burnerAddress, data.burnerAddress);
            return { hasLocal: true, existsOnServer: true, address: data.burnerAddress };
          }
        } catch {
          // Invalid local key, clear it
          safeLocalStorage.removeItem(keys.burnerKey);
          safeLocalStorage.removeItem(keys.burnerAddress);
        }
      }
      
      // Burner exists on server but no valid local key - needs restore
      return { hasLocal: false, existsOnServer: true, address: data.burnerAddress };
    } catch (err) {
      console.error('Error checking burner on backend:', err);
      return { hasLocal: false, existsOnServer: false, address: null };
    }
  };

  // Restore burner from server (cross-device sync)
  // Requires signature from mainWallet to prove ownership
  const restoreBurnerFromServer = useCallback(async (): Promise<boolean> => {
    if (!mainWallet || !serverBurnerAddress) {
      setRestoreError('No wallet connected or no burner to restore');
      return false;
    }

    setIsRestoringFromServer(true);
    setRestoreError(null);

    try {
      const timestamp = Date.now().toString();
      const message = `Restore Basion burner for ${mainWallet} at ${timestamp}`;
      
      // Request signature from user
      const signature = await signMessageAsync({ message });
      
      // Call restore API
      const response = await fetch('/api/restore-burner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: mainWallet,
          signature,
          timestamp,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setRestoreError(data.error || 'Failed to restore burner');
        return false;
      }

      // Save restored key to localStorage
      const keys = getStorageKeys(mainWallet);
      safeLocalStorage.setItem(keys.burnerKey, data.privateKey);
      safeLocalStorage.setItem(keys.burnerAddress, data.burnerAddress);

      // Update state
      setBurnerAddress(data.burnerAddress);
      setHasBurner(true);
      setNeedsRestore(false);
      setServerBurnerAddress(null);

      // Dispatch event to notify other components
      window.dispatchEvent(new Event(BURNER_CREATED_EVENT));

      return true;
    } catch (err) {
      console.error('Failed to restore burner from server:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      
      if (errorMessage.includes('User rejected') || errorMessage.includes('user rejected')) {
        setRestoreError('Signature cancelled');
      } else {
        setRestoreError(errorMessage);
      }
      return false;
    } finally {
      setIsRestoringFromServer(false);
    }
  }, [mainWallet, serverBurnerAddress, signMessageAsync]);

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
    safeLocalStorage.setItem(keys.burnerKey, wallet.privateKey);
    safeLocalStorage.setItem(keys.burnerAddress, wallet.address);

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
    const privateKey = safeLocalStorage.getItem(keys.burnerKey);
    const address = safeLocalStorage.getItem(keys.burnerAddress);
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
    return safeLocalStorage.getItem(keys.burnerAddress);
  }, [mainWallet]);

  // Clear burner wallet for current mainWallet
  const clearBurner = useCallback((): void => {
    if (typeof window === 'undefined') return;
    if (!mainWallet) return;

    const keys = getStorageKeys(mainWallet);
    safeLocalStorage.removeItem(keys.burnerKey);
    safeLocalStorage.removeItem(keys.burnerAddress);

    setBurnerAddress(null);
    setHasBurner(false);
  }, [mainWallet]);

  // Register burner with backend (to enable cross-device restore)
  // SECURITY:
  // - Preferred: txHash-based proof (no signMessage prompts; works reliably in Base App)
  // - Fallback: signature-based proof (EOA wallets)
  const registerBurnerWithBackend = useCallback(
    async (
      burnerAddr: string,
      privateKey: string,
      options?: { txHash?: string }
    ): Promise<{ ok: boolean; error?: string }> => {
    if (!mainWallet) return { ok: false, error: 'Wallet not connected' };
    
    try {
      if (options?.txHash) {
        const response = await fetch('/api/register-burner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mainWallet: mainWallet,
            burnerWallet: burnerAddr,
            privateKey: privateKey, // Server will encrypt this
            txHash: options.txHash,
          }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          return { ok: false, error: data?.error || 'Failed to sync tap wallet' };
        }
        return { ok: true };
      }

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
        const data = await response.json().catch(() => ({}));
        console.error('Failed to register burner:', data.error);
        return { ok: false, error: data?.error || 'Failed to sync tap wallet' };
      }
      return { ok: true };
    } catch (err) {
      console.error('Failed to register burner with backend:', err);
      return { ok: false, error: 'Failed to sync tap wallet' };
    }
  }, [mainWallet, signMessageAsync]);

  // Manual sync for existing users: upload local burner key to server (encrypted).
  const syncBurnerToServer = useCallback(async (): Promise<boolean> => {
    if (!mainWallet) return false;
    const burner = getBurner();
    if (!burner) {
      setServerSyncError('Tap wallet not found on this device');
      return false;
    }

    const normalizedMain = mainWallet.toLowerCase();
    const serverSyncedMarkerKey = `basion_burner_server_synced_${normalizedMain}`;

    setIsSyncingToServer(true);
    setServerSyncError(null);
    try {
      const result = await registerBurnerWithBackend(burner.address, burner.privateKey);
      if (result.ok) {
        safeLocalStorage.setItem(serverSyncedMarkerKey, '1');
        setNeedsServerSync(false);
        // Invalidate any earlier in-flight server check that could re-show the banner.
        serverSyncCheckTokenRef.current++;
        return true;
      }
      setServerSyncError(result.error || 'Failed to sync tap wallet');
      return false;
    } finally {
      setIsSyncingToServer(false);
    }
  }, [getBurner, mainWallet, registerBurnerWithBackend]);

  // Send tap transaction via burner wallet
  // OPTIMIZED: All params explicit to avoid RPC calls - enables 1 tap/sec
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
      cachedGasPrice = null;
    }

    // Get nonce - fetch once from RPC, then increment locally
    if (currentNonce === null) {
      currentNonce = await provider.getTransactionCount(cachedWallet.address, 'pending');
    }

    // Get gas price - cache for 30 seconds to avoid RPC calls
    const now = Date.now();
    if (cachedGasPrice === null || now - gasPriceLastFetch > GAS_PRICE_CACHE_MS) {
      // Use the same source as the "gas too high" gate: eth_gasPrice.
      // This keeps behavior consistent with MAX_GAS_GWEI.
      const gasPriceHex = (await provider.send('eth_gasPrice', [])) as string;
      cachedGasPrice = BigInt(gasPriceHex);
      gasPriceLastFetch = now;
    }

    // Safety: enforce the 0.005 gwei rule at send-time too.
    if (cachedGasPrice > MAX_GAS_PRICE_WEI) {
      throw new Error('Gas too high');
    }

    // Use current nonce and increment for next tx
    const nonce = currentNonce++;

    // Send with ALL params explicit - NO additional RPC calls needed
    const tx = await cachedContract.tap({
      nonce,
      gasLimit: FIXED_GAS_LIMIT,
      gasPrice: cachedGasPrice,
    });
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
      const gasPriceHex = (await provider.send('eth_gasPrice', [])) as string;
      const gasPriceWei = BigInt(gasPriceHex);
      const estimatedGas = BigInt(50000 + count * 5000);
      const gasCost = estimatedGas * gasPriceWei;
      
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
    // Cross-device restore
    needsRestore,
    serverBurnerAddress,
    isRestoringFromServer,
    restoreError,
    restoreBurnerFromServer,
    // Cross-device server sync (existing users)
    needsServerSync,
    isSyncingToServer,
    serverSyncError,
    syncBurnerToServer,
    // Actions
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
