'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useBurnerWallet, useTapThrottle, useBasionContract, useUserPoints } from '@/hooks';
import { FloatingText } from '@/types';
import FloatingBubble from './FloatingBubble';
import CongestionModal from './CongestionModal';
import { isGasTooHigh } from '@/lib/gasPrice';

interface TapAreaProps {
  onOpenDeposit: () => void;
  onTapSuccess?: () => void;
}

function isProbablyBaseAppClient(): boolean {
  if (typeof window === 'undefined') return false;

  const w = window as unknown as Record<string, unknown>;
  if (w.__BASION_BASEAPP__ === true) return true;
  if (w.__BASION_MINIAPP__ === true) return true;

  const ua = navigator.userAgent || '';
  const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(ua);
  if (!isMobile) return false;

  const hasCoinbaseUa = /CoinbaseWallet|Coinbase Wallet|CBW|BaseApp/i.test(ua);
  const eth = (window as unknown as { ethereum?: { isCoinbaseWallet?: boolean } }).ethereum;
  const hasCoinbaseProvider = Boolean(eth?.isCoinbaseWallet);
  return hasCoinbaseUa || hasCoinbaseProvider;
}

const TapArea: React.FC<TapAreaProps> = ({ onOpenDeposit, onTapSuccess }) => {
  const [bubbles, setBubbles] = useState<FloatingText[]>([]);
  const [localTaps, setLocalTaps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hasSynced, setHasSynced] = useState(false);
  const [isBanned, setIsBanned] = useState(false);
  const [referralBonusClaimed, setReferralBonusClaimed] = useState(false);
  const [showCongestionModal, setShowCongestionModal] = useState(false);
  
  // Ref for debounced sync
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSyncRef = useRef(false);
  const isFirstTapRef = useRef(true);
  const lastTxHashRef = useRef<string | null>(null);
  const pendingTxCountRef = useRef(0);
  const boostSyncedRef = useRef(false);

  const { 
    hasBurner, 
    sendTap, 
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
  } = useBurnerWallet();
  const { canTap, recordTap, completeTap } = useTapThrottle();
  const { 
    tapBalance, 
    isConnected, 
    address, 
    refetchGameStats 
  } = useBasionContract();
  const { 
    boostPercent, 
    refetchPoints 
  } = useUserPoints();

  // Check if user is banned
  useEffect(() => {
    if (address) {
      fetch(`/api/admin/ban?wallet=${address}`)
        .then(res => {
          if (!res.ok) {
            console.warn('Failed to check ban status:', res.status);
            return null;
          }
          return res.json();
        })
        .then(data => {
          if (data?.isBanned) {
            setIsBanned(true);
            setError('Your wallet is banned');
          }
        })
        .catch(err => console.warn('Network error checking ban status:', err));
    }
  }, [address]);

  // Sync local state with contract
  useEffect(() => {
    setLocalTaps(tapBalance);
  }, [tapBalance]);

  // Debounced sync with Supabase (max once per 5 sec)
  // Points are now calculated server-side with boost
  const debouncedSync = useCallback(async (txHash?: string) => {
    if (!address || pendingSyncRef.current) return;
    
    // Need txHash for authentication
    const hashToUse = txHash || lastTxHashRef.current;
    if (!hashToUse) return;
    
    pendingSyncRef.current = true;
    
    try {
      // Sync to Supabase - server calculates points with boost
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(isProbablyBaseAppClient() ? { 'x-basion-client': 'base-app' } : {}),
      };
      const response = await fetch('/api/sync-user', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mainWallet: address,
          txHash: hashToUse,
          tapCount: 1,
        }),
      });
      
      if (response.ok) {
        // Refetch points from DB to update UI
        await refetchPoints();
      }
      
      // Also refetch taps from contract
      await refetchGameStats();
    } catch (err) {
      console.error('Sync error:', err);
    } finally {
      pendingSyncRef.current = false;
    }
  }, [address, refetchGameStats, refetchPoints]);

  // Schedule sync (with 5 sec debounce)
  const scheduleSync = useCallback((txHash?: string) => {
    if (txHash) {
      lastTxHashRef.current = txHash;
    }
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(() => debouncedSync(txHash), 5000);
  }, [debouncedSync]);

  // Mark as synced when contract data is loaded (actual sync happens after taps)
  useEffect(() => {
    if (address && !hasSynced && tapBalance >= 0) {
      // No initial sync needed - data syncs after each tap via txHash
      setHasSynced(true);
    }
  }, [address, hasSynced, tapBalance]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  // Auto-clear error after 3 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const removeBubble = useCallback((id: number) => {
    setBubbles((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const handleTap = useCallback(
    async (e: React.PointerEvent<HTMLDivElement>) => {
      // Prevent default to avoid any browser handling
      e.preventDefault();
      
      // Clear previous error
      setError(null);

      // Check if banned
      if (isBanned) {
        setError('Your wallet is banned');
        return;
      }

      // Check gas price - block taps when network is congested
      const gasTooHigh = await isGasTooHigh();
      if (gasTooHigh) {
        setShowCongestionModal(true);
        return;
      }

      // Check connection
      if (!isConnected) {
        setError('Connect your wallet');
        return;
      }

      // Check burner wallet
      if (!hasBurner) {
        setError('Please deposit first');
        onOpenDeposit();
        return;
      }

      // Check tap balance (account for pending transactions)
      if (localTaps - pendingTxCountRef.current <= 0) {
        setError('Out of taps! Buy more.');
        onOpenDeposit();
        return;
      }

      // Check cooldown (2 seconds between taps)
      if (!canTap()) {
        return; // Silently ignore too fast taps
      }

      // Get click position from pointer event
      const clientX = e.clientX;
      const clientY = e.clientY;

      // Record tap timing immediately
      recordTap();
      
      // Increment pending counter
      pendingTxCountRef.current++;

      // Create bubble animation (visual +1 always, boost applied server-side)
      const newBubble: FloatingText = {
        id: Date.now() + Math.random(),
        x: clientX,
        y: clientY,
        value: 1,
      };
      setBubbles((prev) => [...prev, newBubble]);

      // Update local taps immediately for responsive UI
      setLocalTaps(prev => Math.max(0, prev - 1));

      // Sync boost to contract on first tap (fire and forget - don't block UI)
      if (!boostSyncedRef.current && address) {
        boostSyncedRef.current = true;
        fetch('/api/sync-boost', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet: address }),
        })
          .then(res => res.json())
          .then(data => {
            if (data.synced) {
              console.log('Boost synced:', data.message);
            }
          })
          .catch(() => {
            // Reset flag on error so we try again next tap
            boostSyncedRef.current = false;
          });
      }

      // Fire and forget - send transaction without blocking
      sendTap()
        .then(async (tx) => {
          // Save txHash for authentication
          const txHash = tx.hash;
          lastTxHashRef.current = txHash;
          
          // Wait for confirmation in background
          await tx.wait();
          
          // Decrement pending counter
          pendingTxCountRef.current = Math.max(0, pendingTxCountRef.current - 1);
          completeTap();
          
          // Fetch updated taps from contract
          await refetchGameStats();
          
          // IMPORTANT: Sync points to DB FIRST (this calculates points with boost)
          if (address) {
            try {
              const headers: HeadersInit = {
                'Content-Type': 'application/json',
                ...(isProbablyBaseAppClient() ? { 'x-basion-client': 'base-app' } : {}),
              };
              const syncRes = await fetch('/api/sync-user', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  mainWallet: address,
                  txHash: txHash,
                  tapCount: 1,
                }),
              });
              
              if (syncRes.ok) {
                const syncData = await syncRes.json();
                console.log('Points synced:', syncData.pointsEarned, 'with boost:', syncData.boostPercent + '%');
              }
            } catch (syncErr) {
              console.error('Sync error:', syncErr);
            }
          }
          
          // NOW fetch updated points from DB (after sync)
          await refetchPoints();
          
          // Call success callback
          if (onTapSuccess) {
            onTapSuccess();
          }

          // Send commission (fire and forget)
          if (address) {
            fetch('/api/commission', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                fromWallet: address,
                txHash: txHash,
              }),
            })
              .then(res => {
                if (!res.ok) console.warn('Failed to send commission:', res.status);
              })
              .catch(err => console.warn('Network error sending commission:', err));
          }

          // Claim referral bonus on first tap
          if (address && isFirstTapRef.current && !referralBonusClaimed) {
            isFirstTapRef.current = false;
            fetch('/api/referral/claim-bonus', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userWallet: address }),
            })
              .then(res => {
                if (!res.ok) {
                  console.warn('Failed to claim referral bonus:', res.status);
                  return null;
                }
                return res.json();
              })
              .then(data => {
                if (data?.bonusApplied) {
                  setReferralBonusClaimed(true);
                  console.log('Referral bonus applied:', data.userBoost + '%');
                }
              })
              .catch(err => console.warn('Network error claiming referral bonus:', err));
          }
        })
        .catch((err) => {
          console.error('Tap error:', err);
          
          // Restore tap on error
          pendingTxCountRef.current = Math.max(0, pendingTxCountRef.current - 1);
          completeTap();
          setLocalTaps(prev => prev + 1);
          
          // Analyze error
          let errorMessage = 'Unknown error';
          if (err instanceof Error) {
            errorMessage = err.message;
          } else if (typeof err === 'string') {
            errorMessage = err;
          } else {
            try {
              errorMessage = JSON.stringify(err);
            } catch {
              errorMessage = String(err);
            }
          }

          const m = (errorMessage || '').toLowerCase();

          if (m.includes('gas too high')) {
            setShowCongestionModal(true);
            return;
          }

          if (m.includes('insufficient funds') || m.includes('insufficient gas')) {
            setError('Tap wallet is out of ETH for gas — deposit to refill');
            return;
          }

          if (m.includes('no burner') || m.includes('burner')) {
            setError('Tap wallet not found — open Deposit to create/sync it');
            return;
          }

          if (m.includes('no taps') || m.includes('out of taps') || m.includes('no taps remaining')) {
            setError('Out of taps! Buy more.');
            setLocalTaps(0);
            return;
          }

          // Common RPC/transient failures that previously looked like "tap works, but no tx"
          if (
            m.includes('nonce') ||
            m.includes('replacement') ||
            m.includes('underpriced') ||
            m.includes('already known')
          ) {
            setError('Transaction pending/nonce issue — wait a few seconds and try again');
            return;
          }

          if (m.includes('failed to fetch') || m.includes('network') || m.includes('timeout')) {
            setError('Network/RPC error — please try again');
            return;
          }

          // Fallback
          setError('Tap failed — please try again');
        });
    },
    [isConnected, hasBurner, localTaps, canTap, sendTap, recordTap, completeTap, refetchGameStats, refetchPoints, onOpenDeposit, scheduleSync, onTapSuccess, address, isBanned, referralBonusClaimed]
  );

  const isDisabled = !isConnected || !hasBurner || localTaps <= 0 || isRestoring || needsRestore || isRestoringFromServer;

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-xl">
      {/* Gas congestion modal */}
      <CongestionModal 
        isOpen={showCongestionModal} 
        onClose={() => setShowCongestionModal(false)} 
      />

      {/* Animated bubbles */}
      {bubbles.map((b) => (
        <FloatingBubble key={b.id} data={b} onComplete={removeBubble} />
      ))}

      {/* Square TAP button - entire white block is clickable */}
      {/* Using onPointerDown instead of onClick+onTouchStart to prevent double-tap on mobile */}
      {/* Responsive: 62vw on mobile (max 270px), fixed 332px on desktop */}
      <motion.div
        whileHover={{ scale: isDisabled ? 1 : 1.02 }}
        whileTap={{ scale: isDisabled ? 1 : 0.95 }}
        onPointerDown={handleTap}
        style={{ backgroundColor: '#FFFFFF' }}
        className={`relative w-[62vw] max-w-[270px] h-[62vw] max-h-[270px] lg:w-[332px] lg:h-[332px] lg:max-w-none lg:max-h-none rounded-[40px] lg:rounded-[56px] shadow-[0_20px_60px_rgba(0,0,0,0.18)] select-none ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {/* Blue square inside - responsive inset - always bright */}
        <div 
          className="absolute inset-[20%] lg:inset-[71px] rounded-[16px] lg:rounded-[18px] pointer-events-none transition-opacity"
          style={{ 
            backgroundColor: '#0000FF',
            opacity: 1,
          }}
        />
      </motion.div>

      {/* Disabled-state hint (mobile-friendly) */}
      {isDisabled && (
        <p className="text-slate-600 text-sm text-center px-4 -mt-2">
          {isRestoring
            ? 'Checking tap wallet...'
            : isRestoringFromServer
              ? 'Restoring tap wallet...'
              : !isConnected
                ? 'Connect your wallet'
                : needsRestore
                  ? 'Tap wallet found on another device — restore it to enable taps'
                  : !hasBurner
                    ? 'Tap wallet not found on this device — open Deposit to create/sync it'
                    : localTaps <= 0
                      ? 'Out of taps — deposit more'
                      : 'Tap is temporarily disabled'}
        </p>
      )}

      {/* Cross-device restore button */}
      <AnimatePresence>
        {needsRestore && isConnected && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="flex flex-col items-center gap-2"
          >
            <p className="text-slate-600 text-sm text-center">
              Tap wallet found on another device
            </p>
            <button
              onClick={restoreBurnerFromServer}
              disabled={isRestoringFromServer}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-400 text-white font-bold rounded-xl shadow-lg shadow-blue-600/30 transition-all active:scale-95"
            >
              {isRestoringFromServer ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Restoring...
                </>
              ) : (
                <>
                  <RefreshCw className="w-5 h-5" />
                  Restore Wallet
                </>
              )}
            </button>
            {serverBurnerAddress && (
              <p className="text-slate-400 text-xs font-mono">
                {serverBurnerAddress.slice(0, 8)}...{serverBurnerAddress.slice(-6)}
              </p>
            )}
            {restoreError && (
              <p className="text-red-500 text-sm">
                {restoreError}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Existing user: sync local tap wallet to server for cross-device restore */}
      <AnimatePresence>
        {needsServerSync && hasBurner && isConnected && !needsRestore && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="flex flex-col items-center gap-2 -mt-2"
          >
            <p className="text-slate-600 text-sm text-center">
              Sync tap wallet to enable cross-device restore
            </p>
            <button
              onClick={syncBurnerToServer}
              disabled={isSyncingToServer}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-400 text-white font-bold rounded-xl shadow-lg shadow-blue-600/30 transition-all active:scale-95"
            >
              {isSyncingToServer ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="w-5 h-5" />
                  Sync now
                </>
              )}
            </button>
            {serverSyncError && (
              <p className="text-red-500 text-sm text-center">
                {serverSyncError}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Show tap errors (don’t hide failures behind the +1 bubble) */}
      {error && (
        <motion.p 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="text-red-500 text-sm bg-red-50/80 px-4 py-2 rounded-lg"
        >
          {error}
        </motion.p>
      )}
    </div>
  );
};

export default React.memo(TapArea);
