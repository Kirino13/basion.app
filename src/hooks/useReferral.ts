'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { STORAGE_KEYS } from '@/config/constants';

export function useReferral() {
  const searchParams = useSearchParams();
  const [storedReferrer, setStoredReferrer] = useState<string | null>(null);

  // Check URL for referrer on mount and store it
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check URL params
    const refParam = searchParams.get('ref');
    if (refParam && refParam.startsWith('0x') && refParam.length === 42) {
      localStorage.setItem(STORAGE_KEYS.referrer, refParam);
      setStoredReferrer(refParam);
      return;
    }

    // Check localStorage for existing referrer
    const stored = localStorage.getItem(STORAGE_KEYS.referrer);
    if (stored) {
      setStoredReferrer(stored);
    }
  }, [searchParams]);

  // Get referrer address
  const getReferrer = useCallback((): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEYS.referrer);
  }, []);

  // Clear referrer (after it's been set on chain)
  const clearReferrer = useCallback((): void => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(STORAGE_KEYS.referrer);
    setStoredReferrer(null);
  }, []);

  // Generate referral link
  const generateReferralLink = useCallback((address: string): string => {
    if (typeof window === 'undefined') return '';
    const baseUrl = window.location.origin;
    return `${baseUrl}?ref=${address}`;
  }, []);

  return {
    storedReferrer,
    getReferrer,
    clearReferrer,
    generateReferralLink,
  };
}
