'use client';

import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { CONTRACT_ADDRESS, GAME_CONFIG } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';

/**
 * Hook for interacting with the Basion smart contract.
 * 
 * NOTE: Points are now stored OFF-CHAIN in the database with decimal support.
 * Use useUserPoints() hook to get points data.
 * This hook only handles: taps, deposits, and burner registration.
 */
export function useBasionContract() {
  const { address } = useAccount();

  // Read user info (taps, multiplier, burner) - this is the main data from contract
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

  // Parse user info (taps and burner from contract)
  const tapBalance = userInfo ? Number(userInfo[0]) : 0;
  const pointsMultiplier = userInfo ? Number(userInfo[1]) : 100;
  const burner = userInfo ? (userInfo[2] as string) : '';

  // Parse referral info
  const referrer = referralInfo ? (referralInfo[0] as string) : '';
  const isBatchMode = referralInfo ? (referralInfo[1] as boolean) : false;

  // Refetch contract data (taps only - points are in DB now)
  const refetchGameStats = async (): Promise<void> => {
    await Promise.all([
      refetchUserInfo(),
      refetchReferralInfo(),
    ]);
    
    // Schedule a delayed refetch to catch any propagation delays
    setTimeout(async () => {
      await Promise.all([
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

    // User info from contract (taps only)
    tapBalance,
    pointsMultiplier,
    burner,
    isBatchMode,

    // Referral
    referrer,

    // Loading states
    isLoadingGameStats: isLoadingUserInfo,

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
