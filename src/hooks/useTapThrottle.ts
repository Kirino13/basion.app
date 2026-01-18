'use client';

import { useRef, useCallback } from 'react';
import { GAME_CONFIG } from '@/config/constants';

const COOLDOWN_MS = GAME_CONFIG.tapCooldownMs;

export function useTapThrottle() {
  const lastTapTimeRef = useRef<number>(0);
  const pendingTapsRef = useRef<number>(0);

  // Check if a tap is allowed
  const canTap = useCallback((): boolean => {
    const now = Date.now();

    // Check cooldown
    if (now - lastTapTimeRef.current < COOLDOWN_MS) {
      return false;
    }

    // Check if there's a pending tap
    if (pendingTapsRef.current > 0) {
      return false;
    }

    return true;
  }, []);

  // Record a tap start
  const recordTap = useCallback((): void => {
    lastTapTimeRef.current = Date.now();
    pendingTapsRef.current++;
  }, []);

  // Mark a tap as complete
  const completeTap = useCallback((): void => {
    pendingTapsRef.current = Math.max(0, pendingTapsRef.current - 1);
  }, []);

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
