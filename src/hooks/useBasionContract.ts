'use client';

import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { CONTRACT_ADDRESS, GAME_CONFIG } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';

export function useBasionContract() {
  const { address } = useAccount();

  // Read points (premium, standard, total)
  const {
    data: pointsData,
    refetch: refetchPoints,
    isLoading: isLoadingPoints,
  } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BASION_ABI,
    functionName: 'getPoints',
    args: address ? [address] : undefined,
    query: { 
      enabled: !!address,
      staleTime: 0, // Always fetch fresh data
      gcTime: 0, // Don't cache
    },
  });

  // Read user info (taps, multiplier, burner)
  const {
    data: userInfo,
    refetch: refetchUserInfo,
    isLoading: isLoadingUserInfo,
  } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BASION_ABI,
    functionName: 'getUserInfo',
    args: address ? [address] : undefined,
    query: { 
      enabled: !!address,
      staleTime: 0,
      gcTime: 0,
    },
  });

  // Read referral info
  const {
    data: referralInfo,
    refetch: refetchReferralInfo,
  } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BASION_ABI,
    functionName: 'getReferralInfo',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // Write contract functions
  const { writeContract, data: txHash, isPending: isWritePending, error: writeError, reset } = useWriteContract();

  // Wait for transaction receipt
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Deposit function - now with packageId (0 or 1) and referrer
  const deposit = (packageId: 0 | 1, referrerAddress?: `0x${string}`) => {
    const pkg = GAME_CONFIG.packages[packageId];
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: BASION_ABI,
      functionName: 'deposit',
      args: [BigInt(packageId), referrerAddress || '0x0000000000000000000000000000000000000000'],
      value: parseEther(pkg.priceEth),
    });
  };

  // Register burner function
  const registerBurner = (burnerAddress: `0x${string}`) => {
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: BASION_ABI,
      functionName: 'registerBurner',
      args: [burnerAddress],
    });
  };

  // Parse points data
  const premiumPoints = pointsData ? Number(pointsData[0]) : 0;
  const standardPoints = pointsData ? Number(pointsData[1]) : 0;
  const totalPoints = pointsData ? Number(pointsData[2]) : 0;
  
  // For backward compatibility, 'points' returns totalPoints
  const points = totalPoints;

  // Parse user info
  const tapBalance = userInfo ? Number(userInfo[0]) : 0;
  const pointsMultiplier = userInfo ? Number(userInfo[1]) : 100;
  const burner = userInfo ? (userInfo[2] as string) : '';

  // Parse referral info
  const referrer = referralInfo ? (referralInfo[0] as string) : '';
  const isBatchMode = referralInfo ? (referralInfo[1] as boolean) : false;

  // Refetch all data (async) - immediate fetch with optional delayed retry
  const refetchGameStats = async (): Promise<void> => {
    // First immediate fetch
    await Promise.all([
      refetchPoints(),
      refetchUserInfo(),
      refetchReferralInfo(),
    ]);
    
    // Schedule a delayed refetch to catch any propagation delays
    setTimeout(async () => {
      await Promise.all([
        refetchPoints(),
        refetchUserInfo(),
        refetchReferralInfo(),
      ]);
    }, 2000);
  };

  const refetchAll = refetchGameStats;

  return {
    // Connection
    address,
    isConnected: !!address,

    // Points
    premiumPoints,
    standardPoints,
    totalPoints,
    points, // Backward compatibility

    // User info
    tapBalance,
    pointsMultiplier,
    burner,
    isBatchMode,

    // Referral
    referrer,

    // Loading states
    isLoadingGameStats: isLoadingPoints || isLoadingUserInfo,

    // Write functions
    deposit,
    registerBurner,

    // Transaction state
    txHash,
    isWritePending,
    isConfirming,
    isConfirmed,
    writeError,
    resetWrite: reset,

    // Utilities
    refetchGameStats,
    refetchAll,
  };
}
