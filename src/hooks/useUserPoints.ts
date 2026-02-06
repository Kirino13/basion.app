'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAccount } from 'wagmi';

interface UserPointsData {
  totalPoints: number;
  premiumPoints: number;
  standardPoints: number;
  boostPercent: number;
  effectiveBoostPercent: number;
  baseAppBonusPercent: number;
  tapsRemaining: number;
}

/**
 * Hook to fetch user points from the database API.
 * Points are stored in DB with decimals (e.g., 43.4) and include boost calculations.
 */
export function useUserPoints() {
  const { address } = useAccount();
  const [data, setData] = useState<UserPointsData>({
    totalPoints: 0,
    premiumPoints: 0,
    standardPoints: 0,
    boostPercent: 0,
    effectiveBoostPercent: 0,
    baseAppBonusPercent: 0,
    tapsRemaining: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch points from API with abort controller support
  const fetchPoints = useCallback(async (signal?: AbortSignal) => {
    if (!address) {
      setData({
        totalPoints: 0,
        premiumPoints: 0,
        standardPoints: 0,
        boostPercent: 0,
        effectiveBoostPercent: 0,
        baseAppBonusPercent: 0,
        tapsRemaining: 0,
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null;
      const headers: HeadersInit =
        w && (w.__BASION_BASEAPP__ === true || w.__BASION_MINIAPP__ === true)
          ? { 'x-basion-client': 'base-app' }
          : {};

      const response = await fetch(`/api/user/${address}`, { signal, headers });
      if (!response.ok) {
        throw new Error('Failed to fetch user data');
      }

      const userData = await response.json();
      
      // Only update state if not aborted
      if (!signal?.aborted) {
        const baseBoostPercent = Number(userData.boostPercent) || 0;
        const effectiveBoostPercent = Number(userData.effectiveBoostPercent);
        const baseAppBonusPercent = Number(userData.baseAppBonusPercent);

        setData({
          totalPoints: Number(userData.totalPoints) || 0,
          premiumPoints: Number(userData.premiumPoints) || 0,
          standardPoints: Number(userData.standardPoints) || 0,
          boostPercent: baseBoostPercent,
          effectiveBoostPercent: Number.isFinite(effectiveBoostPercent) ? effectiveBoostPercent : baseBoostPercent,
          baseAppBonusPercent: Number.isFinite(baseAppBonusPercent) ? baseAppBonusPercent : 0,
          tapsRemaining: Number(userData.tapsRemaining) || 0,
        });
      }
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Error fetching user points:', err);
      if (!signal?.aborted) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [address]);

  // Initial fetch when address changes with cleanup
  useEffect(() => {
    const abortController = new AbortController();
    fetchPoints(abortController.signal);
    return () => abortController.abort();
  }, [fetchPoints]);

  // Re-fetch when Base App / Mini App env becomes known
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => fetchPoints();
    window.addEventListener('basion:client-env-changed', handler);
    return () => window.removeEventListener('basion:client-env-changed', handler);
  }, [fetchPoints]);

  // Refetch function for external use (e.g., after a tap)
  const refetchPoints = useCallback(async () => {
    await fetchPoints();
  }, [fetchPoints]);

  // Calculate points per tap based on current boost
  const pointsPerTap = 1 * (1 + data.effectiveBoostPercent / 100);

  return {
    // Points data
    points: data.totalPoints,
    totalPoints: data.totalPoints,
    premiumPoints: data.premiumPoints,
    standardPoints: data.standardPoints,
    boostPercent: data.boostPercent,
    effectiveBoostPercent: data.effectiveBoostPercent,
    baseAppBonusPercent: data.baseAppBonusPercent,
    tapsRemaining: data.tapsRemaining,
    
    // Calculated
    pointsPerTap,
    
    // State
    isLoading,
    error,
    
    // Actions
    refetchPoints,
  };
}
