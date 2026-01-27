'use client';

import { useState, useCallback, useEffect } from 'react';
import { useAccount } from 'wagmi';

interface UserPointsData {
  totalPoints: number;
  premiumPoints: number;
  standardPoints: number;
  boostPercent: number;
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
        tapsRemaining: 0,
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/user/${address}`, { signal });
      if (!response.ok) {
        throw new Error('Failed to fetch user data');
      }

      const userData = await response.json();
      
      // Only update state if not aborted
      if (!signal?.aborted) {
        setData({
          totalPoints: Number(userData.totalPoints) || 0,
          premiumPoints: Number(userData.premiumPoints) || 0,
          standardPoints: Number(userData.standardPoints) || 0,
          boostPercent: Number(userData.boostPercent) || 0,
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

  // Refetch function for external use (e.g., after a tap)
  const refetchPoints = useCallback(async () => {
    await fetchPoints();
  }, [fetchPoints]);

  // Calculate points per tap based on current boost
  const pointsPerTap = 1 * (1 + data.boostPercent / 100);

  return {
    // Points data
    points: data.totalPoints,
    totalPoints: data.totalPoints,
    premiumPoints: data.premiumPoints,
    standardPoints: data.standardPoints,
    boostPercent: data.boostPercent,
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
