'use client';

import { useRef, useCallback } from 'react';

// Simple 1 second cooldown between taps
const COOLDOWN_MS = 1000;

export function useTapThrottle() {
  const lastTapTimeRef = useRef<number>(0);

  // Check if a tap is allowed (1 second since last tap)
  const canTap = useCallback((): boolean => {
    const now = Date.now();
    return now - lastTapTimeRef.current >= COOLDOWN_MS;
  }, []);

  // Record a tap
  const recordTap = useCallback((): void => {
    lastTapTimeRef.current = Date.now();
  }, []);

  // No-op for compatibility
  const completeTap = useCallback((): void => {}, []);

  // Get remaining cooldown time in ms
  const getRemainingCooldown = useCallback((): number => {
    const elapsed = Date.now() - lastTapTimeRef.current;
    return Math.max(0, COOLDOWN_MS - elapsed);
  }, []);

  // Check if currently on cooldown
  const isOnCooldown = useCallback((): boolean => {
    return getRemainingCooldown() > 0;
  }, [getRemainingCooldown]);

  return {
    canTap,
    recordTap,
    completeTap,
    getRemainingCooldown,
    isOnCooldown,
  };
}
