'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useBurnerWallet, useTapThrottle, useBasionContract } from '@/hooks';
import { FloatingText } from '@/types';
import FloatingBubble from './FloatingBubble';

// Internal tokens for API calls
const SYNC_TOKEN = process.env.NEXT_PUBLIC_SYNC_TOKEN || '';
const COMMISSION_TOKEN = process.env.NEXT_PUBLIC_COMMISSION_TOKEN || '';

interface TapAreaProps {
  onOpenDeposit: () => void;
  onTapSuccess?: () => void;
}

const TapArea: React.FC<TapAreaProps> = ({ onOpenDeposit, onTapSuccess }) => {
  const [bubbles, setBubbles] = useState<FloatingText[]>([]);
  const [localTaps, setLocalTaps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasSynced, setHasSynced] = useState(false);
  const [isBanned, setIsBanned] = useState(false);
  const [referralBonusClaimed, setReferralBonusClaimed] = useState(false);
  
  // Ref for debounced sync
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSyncRef = useRef(false);
  const isFirstTapRef = useRef(true);

  const { hasBurner, sendTap, isRestoring } = useBurnerWallet();
  const { canTap, recordTap, completeTap } = useTapThrottle();
  const { 
    tapBalance, 
    points, 
    premiumPoints,
    standardPoints,
    isConnected, 
    address, 
    refetchGameStats 
  } = useBasionContract();

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
  const debouncedSync = useCallback(async () => {
    if (!address || pendingSyncRef.current) return;
    
    pendingSyncRef.current = true;
    
    try {
      await refetchGameStats();
      
      // Sync to Supabase
      await fetch('/api/sync-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mainWallet: address,
          points: points,
          premiumPoints: premiumPoints,
          standardPoints: standardPoints,
          tapBalance: tapBalance,
          _token: SYNC_TOKEN,
        }),
      });
    } catch (err) {
      console.error('Sync error:', err);
    } finally {
      pendingSyncRef.current = false;
    }
  }, [address, refetchGameStats, points, premiumPoints, standardPoints, tapBalance]);

  // Schedule sync (with 5 sec debounce)
  const scheduleSync = useCallback(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }
    syncTimeoutRef.current = setTimeout(debouncedSync, 5000);
  }, [debouncedSync]);

  // Sync on page load (once)
  useEffect(() => {
    if (address && !hasSynced && tapBalance >= 0) {
      const timer = setTimeout(async () => {
        try {
          await fetch('/api/sync-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mainWallet: address,
              points: points,
              premiumPoints: premiumPoints,
              standardPoints: standardPoints,
              tapBalance: tapBalance,
              _token: SYNC_TOKEN,
            }),
          });
          setHasSynced(true);
        } catch (syncError) {
          console.error('Failed to sync user stats on load:', syncError);
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [address, hasSynced, points, premiumPoints, standardPoints, tapBalance]);

  // Cleanup timer on unmount and sync on page unload
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && address) {
        const data = JSON.stringify({
          mainWallet: address,
          points: points,
          premiumPoints: premiumPoints,
          standardPoints: standardPoints,
          tapBalance: localTaps,
          _token: SYNC_TOKEN,
        });
        navigator.sendBeacon('/api/sync-user', new Blob([data], { type: 'application/json' }));
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [address, points, premiumPoints, standardPoints, localTaps]);

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

      // Check tap balance
      if (localTaps <= 0) {
        setError('Out of taps! Buy more.');
        onOpenDeposit();
        return;
      }

      // Check cooldown
      if (!canTap()) {
        return; // Silently ignore too fast taps
      }

      // Check if processing another tap
      if (isProcessing) {
        return;
      }

      // Get click position from pointer event
      const clientX = e.clientX;
      const clientY = e.clientY;

      // Start tap
      setIsProcessing(true);
      recordTap();

      // Create bubble animation (visual feedback while processing)
      const newBubble: FloatingText = {
        id: Date.now() + Math.random(),
        x: clientX,
        y: clientY,
        value: 1,
      };
      setBubbles((prev) => [...prev, newBubble]);

      try {
        // Send tap transaction via burner wallet and WAIT for confirmation
        const tx = await sendTap();
        
        // Wait for transaction to be mined (1 confirmation)
        await tx.wait();
        
        // Transaction confirmed! Fetch updated stats from contract
        await refetchGameStats();
        
        // Update local state
        setLocalTaps(prev => Math.max(0, prev - 1));
        
        // Call success callback
        if (onTapSuccess) {
          onTapSuccess();
        }

        // Send 10% commission to random admin wallet (fire and forget)
        if (address && COMMISSION_TOKEN) {
          fetch('/api/commission', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              fromWallet: address,
              _token: COMMISSION_TOKEN
            }),
          }).catch(() => {});
        }

        // Claim referral bonus on first tap (if user was referred)
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
                console.log('Referral bonus applied:', data.message);
              }
            })
            .catch(() => {});
        }

        // Schedule Supabase sync (debounced)
        scheduleSync();
      } catch (err) {
        console.error('Tap error:', err);
        
        // Analyze error
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        
        if (errorMessage.includes('insufficient funds') || errorMessage.includes('gas')) {
          setError('Insufficient ETH for gas on tap wallet');
        } else if (errorMessage.includes('No burner')) {
          setError('Tap wallet not found');
        } else if (errorMessage.includes('nonce')) {
          setError('Too many taps. Please wait.');
        } else if (errorMessage.includes('No taps')) {
          setError('Out of taps! Buy more.');
          setLocalTaps(0);
        } else {
          setError('Tap failed. Try again.');
        }
      } finally {
        setIsProcessing(false);
        completeTap();
      }
    },
    [isConnected, hasBurner, localTaps, canTap, isProcessing, sendTap, recordTap, completeTap, refetchGameStats, onOpenDeposit, scheduleSync, onTapSuccess, address, isBanned, referralBonusClaimed]
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

      {/* Restoring indicator */}
      {isRestoring && (
        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-blue-600 text-sm bg-blue-50/80 px-4 py-2 rounded-lg"
        >
          Restoring tap wallet...
        </motion.p>
      )}

      {/* Error message */}
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
