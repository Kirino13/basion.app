'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useBurnerWallet, useTapThrottle, useBasionContract } from '@/hooks';
import { FloatingText } from '@/types';
import FloatingBubble from './FloatingBubble';

interface TapAreaProps {
  onOpenDeposit: () => void;
  onTapSuccess?: () => void;
}

const TapArea: React.FC<TapAreaProps> = ({ onOpenDeposit, onTapSuccess }) => {
  const [bubbles, setBubbles] = useState<FloatingText[]>([]);
  const [localTaps, setLocalTaps] = useState(0);
  const [localPoints, setLocalPoints] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [hasSynced, setHasSynced] = useState(false);
  
  // Ref for debounced sync
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSyncRef = useRef(false);

  const { hasBurner, sendTap } = useBurnerWallet();
  const { canTap, recordTap, completeTap } = useTapThrottle();
  const { tapBalance, points, totalTaps, isConnected, address, refetchGameStats } = useBasionContract();

  // Sync local state with contract
  useEffect(() => {
    setLocalTaps(tapBalance);
  }, [tapBalance]);

  // Debounced sync with Supabase (max once per 5 sec)
  const debouncedSync = useCallback(async () => {
    if (!address || pendingSyncRef.current) return;
    
    pendingSyncRef.current = true;
    
    try {
      const result = await refetchGameStats();
      if (result.data) {
        const data = result.data as [bigint, bigint, bigint, string];
        await fetch('/api/sync-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mainWallet: address,
            points: Number(data[1]),
            totalTaps: Number(data[2]),
            tapBalance: Number(data[0]),
          }),
        });
      }
    } catch (err) {
      console.error('Sync error:', err);
    } finally {
      pendingSyncRef.current = false;
    }
  }, [address, refetchGameStats]);

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
              totalTaps: totalTaps,
              tapBalance: tapBalance,
            }),
          });
          setHasSynced(true);
        } catch (syncError) {
          console.error('Failed to sync user stats on load:', syncError);
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [address, hasSynced, points, totalTaps, tapBalance]);

  // Cleanup timer on unmount and sync on page unload
  useEffect(() => {
    // Sync data when page becomes hidden (user switches tab or closes)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && address) {
        // Use sendBeacon for reliable sync on page hide
        const data = JSON.stringify({
          mainWallet: address,
          points: points,
          totalTaps: totalTaps,
          tapBalance: localTaps,
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
  }, [address, points, totalTaps, localTaps]);

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
    async (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
      // Clear previous error
      setError(null);

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

      // Get click position
      let clientX: number, clientY: number;
      if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      // Start tap
      setIsProcessing(true);
      recordTap();

      // Create bubble animation
      const newBubble: FloatingText = {
        id: Date.now() + Math.random(),
        x: clientX,
        y: clientY,
        value: 1,
      };
      setBubbles((prev) => [...prev, newBubble]);

      // Optimistic UI update
      setLocalTaps((prev) => Math.max(0, prev - 1));

      try {
        // Send tap transaction via burner wallet
        await sendTap();
        
        // Call success callback for optimistic update
        if (onTapSuccess) {
          onTapSuccess();
        }

        // Update state from contract after 2 seconds
        setTimeout(() => {
          refetchGameStats();
          // Schedule Supabase sync (debounced - max once per 5 sec)
          scheduleSync();
        }, 2000);
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
        } else {
          setError('Tap failed. Try again.');
        }

        // Rollback optimistic update
        setLocalTaps((prev) => prev + 1);
      } finally {
        setIsProcessing(false);
        completeTap();
      }
    },
    [isConnected, hasBurner, localTaps, canTap, isProcessing, sendTap, recordTap, completeTap, refetchGameStats, onOpenDeposit, scheduleSync]
  );

  const isDisabled = !isConnected || !hasBurner || localTaps <= 0;

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-xl">
      {/* Animated bubbles */}
      {bubbles.map((b) => (
        <FloatingBubble key={b.id} data={b} onComplete={removeBubble} />
      ))}

      {/* Square TAP button - entire white block is clickable */}
      <motion.div
        whileHover={{ scale: isDisabled ? 1 : 1.02 }}
        whileTap={{ scale: isDisabled ? 1 : 0.95 }}
        onClick={handleTap}
        onTouchStart={handleTap}
        className={`relative w-64 h-64 lg:w-72 lg:h-72 bg-white rounded-[48px] shadow-[0_18px_50px_rgba(0,0,0,0.15)] select-none ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {/* Blue square inside */}
        <div 
          className="absolute inset-[70px] bg-[#0000FF] rounded-[16px] pointer-events-none"
        />
      </motion.div>

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
