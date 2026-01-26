'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useBurnerWallet, useTapThrottle, useBasionContract, useUserPoints } from '@/hooks';
import { FloatingText } from '@/types';
import FloatingBubble from './FloatingBubble';

interface TapAreaProps {
  onOpenDeposit: () => void;
  onTapSuccess?: () => void;
}

const TapArea: React.FC<TapAreaProps> = ({ onOpenDeposit, onTapSuccess }) => {
  const [bubbles, setBubbles] = useState<FloatingText[]>([]);
  const [localTaps, setLocalTaps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hasSynced, setHasSynced] = useState(false);
  const [isBanned, setIsBanned] = useState(false);
  const [referralBonusClaimed, setReferralBonusClaimed] = useState(false);
  
  // Ref for debounced sync
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSyncRef = useRef(false);
  const isFirstTapRef = useRef(true);
  const lastTxHashRef = useRef<string | null>(null);
  const pendingTxCountRef = useRef(0);
  const boostSyncedRef = useRef(false);

  const { hasBurner, sendTap, isRestoring } = useBurnerWallet();
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
        .then(res => res.json())
        .then(data => {
          if (data.isBanned) {
            setIsBanned(true);
            setError('Your wallet is banned');
          }
        })
        .catch(() => {});
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
      const response = await fetch('/api/sync-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
              const syncRes = await fetch('/api/sync-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            }).catch(() => {});
          }

          // Claim referral bonus on first tap
          if (address && isFirstTapRef.current && !referralBonusClaimed) {
            isFirstTapRef.current = false;
            fetch('/api/referral/claim-bonus', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userWallet: address }),
            })
              .then(res => res.json())
              .then(data => {
                if (data.bonusApplied) {
                  setReferralBonusClaimed(true);
                }
              })
              .catch(() => {});
          }
        })
        .catch((err) => {
          console.error('Tap error:', err);
          
          // Restore tap on error
          pendingTxCountRef.current = Math.max(0, pendingTxCountRef.current - 1);
          completeTap();
          setLocalTaps(prev => prev + 1);
          
          // Analyze error
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          
          if (errorMessage.includes('insufficient funds') || errorMessage.includes('gas')) {
            setError('Insufficient ETH for gas');
          } else if (errorMessage.includes('No burner')) {
            setError('Tap wallet not found');
          } else if (errorMessage.includes('nonce')) {
            // Nonce error - don't show, just retry on next tap
          } else if (errorMessage.includes('No taps')) {
            setError('Out of taps! Buy more.');
            setLocalTaps(0);
          }
        });
    },
    [isConnected, hasBurner, localTaps, canTap, sendTap, recordTap, completeTap, refetchGameStats, refetchPoints, onOpenDeposit, scheduleSync, onTapSuccess, address, isBanned, referralBonusClaimed]
  );

  const isDisabled = !isConnected || !hasBurner || localTaps <= 0 || isRestoring;

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-xl">
      {/* Animated bubbles */}
      {bubbles.map((b) => (
        <FloatingBubble key={b.id} data={b} onComplete={removeBubble} />
      ))}

      {/* Square TAP button - entire white block is clickable */}
      {/* Using onPointerDown instead of onClick+onTouchStart to prevent double-tap on mobile */}
      {/* Size increased by 15%: 256px → 294px, 288px → 332px */}
      <motion.div
        whileHover={{ scale: isDisabled ? 1 : 1.02 }}
        whileTap={{ scale: isDisabled ? 1 : 0.95 }}
        onPointerDown={handleTap}
        className={`relative w-[294px] h-[294px] lg:w-[332px] lg:h-[332px] bg-white rounded-[56px] shadow-[0_20px_60px_rgba(0,0,0,0.18)] select-none touch-none ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {/* Blue square inside - increased by 25% (less white border) */}
        <div 
          className="absolute inset-[63px] lg:inset-[71px] bg-[#0000FF] rounded-[18px] pointer-events-none"
        />
      </motion.div>

      {/* Only show: connect wallet, banned, deposit messages */}
      {error && (error.includes('deposit') || error.includes('taps') || error.includes('Connect') || error.includes('banned')) && (
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
