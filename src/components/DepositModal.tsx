'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Wallet, Zap, Check, Loader2 } from 'lucide-react';
import { parseEther } from 'viem';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { CONTRACT_ADDRESS, GAME_CONFIG, STORAGE_KEYS } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';
import { useBurnerWallet, useBasionContract } from '@/hooks';
import { getEthPrice, usdToEth } from '@/lib/price';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDepositSuccess?: () => void;
}

type DepositStep = 'select' | 'creating-burner' | 'registering' | 'depositing' | 'done' | 'error';

const DepositModal: React.FC<DepositModalProps> = ({ isOpen, onClose, onDepositSuccess }) => {
  const { address } = useAccount();
  const [selectedPackage, setSelectedPackage] = useState<0 | 1>(0);
  const [ethPrice, setEthPrice] = useState<number | null>(null);
  const [isPriceLoading, setIsPriceLoading] = useState(true);
  const [step, setStep] = useState<DepositStep>('select');
  const [error, setError] = useState<string | null>(null);
  const [newBurnerAddress, setNewBurnerAddress] = useState<string | null>(null);

  const { createBurner, getBurner, hasBurner, registerBurnerWithBackend } = useBurnerWallet();
  const { burner: contractBurner, refetchGameStats } = useBasionContract();
  
  const { writeContract, data: txHash, isPending: isWritePending, error: writeError, reset: resetWrite } = useWriteContract();
  
  const { isLoading: isConfirming, isSuccess: txConfirmed, isError: txFailed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const packages = GAME_CONFIG.packages;
  const selectedPkg = packages[selectedPackage];
  
  // Dynamic ETH amount based on current ETH price
  // Add 1% buffer for price fluctuation between calculation and transaction
  const ethAmount = ethPrice && ethPrice > 0 
    ? usdToEth(selectedPkg.usd, ethPrice, 1) // 1% buffer
    : selectedPkg.priceEth; // Fallback to fixed price

  // Get referrer from localStorage
  const getReferrer = (): `0x${string}` => {
    if (typeof window === 'undefined') return '0x0000000000000000000000000000000000000000';
    const stored = localStorage.getItem(STORAGE_KEYS.referrer);
    if (stored && stored.startsWith('0x') && stored.length === 42) {
      return stored as `0x${string}`;
    }
    return '0x0000000000000000000000000000000000000000';
  };

  // Load ETH price on open
  useEffect(() => {
    if (isOpen) {
      setIsPriceLoading(true);
      getEthPrice()
        .then((price) => {
          setEthPrice(price);
          setIsPriceLoading(false);
        })
        .catch((err) => {
          console.error('Failed to fetch ETH price:', err);
          // Still allow deposit with contract prices
          setIsPriceLoading(false);
        });
    }
  }, [isOpen]);

  // Reset state on modal open
  useEffect(() => {
    if (isOpen) {
      setStep('select');
      setError(null);
      setNewBurnerAddress(null);
      resetWrite();
    }
  }, [isOpen, resetWrite]);

  // Handle transaction confirmation
  useEffect(() => {
    if (txConfirmed) {
      if (step === 'registering') {
        // Burner registered, now deposit
        proceedToDeposit();
      } else if (step === 'depositing') {
        // Deposit confirmed!
        setStep('done');
        refetchGameStats();
        
        // Register referral if exists (authenticated with txHash)
        const referrer = getReferrer();
        if (address && txHash && referrer && referrer !== '0x0000000000000000000000000000000000000000') {
          fetch('/api/referral/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              userWallet: address, 
              referrerWallet: referrer,
              txHash: txHash,
            }),
          }).catch(() => {});
        }
        
        // Track deposit in USD using txHash for authentication
        if (address && txHash) {
          const usdAmount = packages[selectedPackage].usd;
          fetch('/api/sync-deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              wallet: address, 
              usdAmount,
              txHash: txHash,
            }),
          }).catch(() => {});
        }
        
        // Notify parent component about successful deposit
        if (onDepositSuccess) {
          onDepositSuccess();
        }
        setTimeout(() => {
          onClose();
        }, 2000);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txConfirmed, step]); // proceedToDeposit/refetchGameStats/onClose are stable

  // Handle transaction error
  useEffect(() => {
    if (txFailed || writeError) {
      const errorMessage = writeError?.message || 'Transaction failed';
      if (errorMessage.includes('User rejected') || errorMessage.includes('user rejected')) {
        setError('Transaction cancelled');
      } else if (errorMessage.includes('Already registered')) {
        // Burner already registered, proceed to deposit
        proceedToDeposit();
        return;
      } else {
        setError(errorMessage.slice(0, 100));
      }
      setStep('error');
    }
  }, [txFailed, writeError]);

  const proceedToDeposit = useCallback(() => {
    setStep('depositing');
    resetWrite();
    
    const referrer = getReferrer();
    
    writeContract({
      address: CONTRACT_ADDRESS,
      abi: BASION_ABI,
      functionName: 'deposit',
      args: [BigInt(selectedPackage), referrer],
      value: parseEther(ethAmount),
    });
  }, [selectedPackage, ethAmount, writeContract, resetWrite]);

  const handleDeposit = async () => {
    if (!address) {
      setError('Wallet not connected');
      return;
    }

    setError(null);

    try {
      // Check if burner exists locally
      let burner = getBurner();
      const burnerRegisteredInContract = contractBurner && contractBurner !== '0x0000000000000000000000000000000000000000';

      if (!burner) {
        // Create new burner
        setStep('creating-burner');
        burner = createBurner();
        setNewBurnerAddress(burner.address);
        
        // Register with backend
        await registerBurnerWithBackend(burner.address, burner.privateKey);
      } else {
        setNewBurnerAddress(burner.address);
      }

      // Check if need to register burner in contract
      if (!burnerRegisteredInContract) {
        setStep('registering');
        
        writeContract({
          address: CONTRACT_ADDRESS,
          abi: BASION_ABI,
          functionName: 'registerBurner',
          args: [burner.address as `0x${string}`],
        });
      } else {
        // Burner already registered, go straight to deposit
        proceedToDeposit();
      }
    } catch (err) {
      console.error('Deposit error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      setStep('error');
    }
  };

  const getStepContent = () => {
    switch (step) {
      case 'select':
        return (
          <>
            <div className="flex flex-col items-center mb-8">
              <div className="w-14 h-14 bg-[#0052FF] rounded-full flex items-center justify-center mb-4 shadow-lg shadow-blue-900/50 border border-white/20">
                <Wallet className="text-white" size={28} />
              </div>
              <h2 className="text-3xl font-black text-white drop-shadow-md">Buy Taps</h2>
            </div>

            {isPriceLoading ? (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-4" />
                <p className="text-white/60">Loading...</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 mb-8">
                  {([0, 1] as const).map((pkg) => (
                    <button
                      key={pkg}
                      onClick={() => setSelectedPackage(pkg)}
                      className={`h-32 rounded-2xl border transition-all duration-200 flex flex-col items-center justify-center gap-2 ${
                        selectedPackage === pkg
                          ? 'border-blue-400 bg-blue-600/40 shadow-[0_0_20px_rgba(59,130,246,0.5)]'
                          : 'border-white/10 bg-white/5 hover:bg-white/10 text-white/60'
                      }`}
                    >
                      <span className="text-3xl font-bold text-white drop-shadow-md">${packages[pkg].usd}</span>
                      <div className="flex items-center gap-1 text-sm font-bold text-blue-200">
                        <Zap size={14} fill="currentColor" />
                        <span>{packages[pkg].taps.toLocaleString()}</span>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="text-center text-white/60 mb-4 space-y-1">
                  <p>Price: <span className="text-white font-bold">{ethAmount} ETH</span></p>
                  {ethPrice && (
                    <p className="text-xs text-white/40">
                      (1 ETH = ${ethPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })})
                    </p>
                  )}
                </div>

                <button
                  onClick={handleDeposit}
                  disabled={isWritePending || isConfirming}
                  className="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 rounded-xl font-bold text-lg text-white shadow-lg shadow-blue-600/30 transform transition active:scale-95 border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isWritePending || isConfirming ? 'Processing...' : 'Confirm Purchase'}
                </button>
              </>
            )}
          </>
        );

      case 'creating-burner':
        return (
          <div className="text-center py-8">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
            <p className="text-white text-lg">Creating tap wallet...</p>
            <p className="text-white/60 text-sm mt-2">This wallet will sign taps automatically</p>
          </div>
        );

      case 'registering':
        return (
          <div className="text-center py-8">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
            <p className="text-white text-lg">Registering tap wallet...</p>
            <p className="text-white/60 text-sm mt-2">Confirm transaction in your wallet (1/2)</p>
          </div>
        );

      case 'depositing':
        return (
          <div className="text-center py-8">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
            <p className="text-white text-lg">Processing deposit...</p>
            <p className="text-white/60 text-sm mt-2">Confirm transaction in your wallet (2/2)</p>
          </div>
        );

      case 'done':
        return (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-white" />
            </div>
            <p className="text-green-400 text-xl font-bold">Ready to tap!</p>
            <p className="text-white/60 text-sm mt-2">
              {packages[selectedPackage].taps.toLocaleString()} taps added
            </p>
            {newBurnerAddress && (
              <p className="text-white/40 text-xs mt-4 font-mono">
                Tap wallet: {newBurnerAddress.slice(0, 10)}...{newBurnerAddress.slice(-8)}
              </p>
            )}
          </div>
        );

      case 'error':
        return (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <X className="w-8 h-8 text-white" />
            </div>
            <p className="text-red-400 text-xl font-bold">Something went wrong</p>
            <p className="text-white/60 text-sm mt-2 break-words">{error}</p>
            <button
              onClick={() => {
                setStep('select');
                setError(null);
                resetWrite();
              }}
              className="mt-4 px-6 py-2 bg-white/10 rounded-lg text-white hover:bg-white/20"
            >
              Try again
            </button>
          </div>
        );
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 w-full max-w-sm shadow-2xl relative"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
            >
              <X size={24} />
            </button>

            {getStepContent()}

            {step === 'select' && !isPriceLoading && (
              <button onClick={onClose} className="mt-4 w-full py-2 text-white/50 hover:text-white/70">
                Cancel
              </button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default DepositModal;
