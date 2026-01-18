'use client';

import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { CONTRACT_ADDRESS } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';

export function useBasionContract() {
  const { address } = useAccount();

  // Read game stats
  const {
    data: gameStats,
    refetch: refetchGameStats,
    isLoading: isLoadingGameStats,
  } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BASION_ABI,
    functionName: 'getGameStats',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // Read referral stats
  const {
    data: referralStats,
    refetch: refetchReferralStats,
    isLoading: isLoadingReferralStats,
  } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: BASION_ABI,
    functionName: 'getReferralStats',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // Write contract functions
  const { writeContract, data: txHash, isPending: isWritePending, error: writeError } = useWriteContract();

  // Wait for transaction receipt
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Deposit function
  const deposit = (packageType: 1 | 2, ethAmount: string) => {
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: BASION_ABI,
      functionName: 'deposit',
      args: [BigInt(packageType)],
      value: parseEther(ethAmount),
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

  // Set referrer function
  const setReferrer = (referrerAddress: `0x${string}`) => {
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: BASION_ABI,
      functionName: 'setReferrer',
      args: [referrerAddress],
    });
  };

  // Parse game stats
  const tapBalance = gameStats ? Number(gameStats[0]) : 0;
  const points = gameStats ? Number(gameStats[1]) : 0;
  const totalTaps = gameStats ? Number(gameStats[2]) : 0;
  const burner = gameStats ? (gameStats[3] as string) : '';

  // Parse referral stats
  const referrer = referralStats ? (referralStats[0] as string) : '';
  const referralActive = referralStats ? (referralStats[1] as boolean) : false;
  const referralBonus = referralStats ? Number(referralStats[2]) : 0;
  const referralCount = referralStats ? Number(referralStats[3]) : 0;

  // Refetch all data
  const refetchAll = () => {
    refetchGameStats();
    refetchReferralStats();
  };

  return {
    // Connection
    address,
    isConnected: !!address,

    // Game stats
    tapBalance,
    points,
    totalTaps,
    burner,
    isLoadingGameStats,
    refetchGameStats,

    // Referral stats
    referrer,
    referralActive,
    referralBonus,
    referralCount,
    isLoadingReferralStats,
    refetchReferralStats,

    // Write functions
    deposit,
    registerBurner,
    setReferrer,

    // Transaction state
    txHash,
    isWritePending,
    isConfirming,
    isConfirmed,
    writeError,

    // Utilities
    refetchAll,
  };
}
