'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Wallet, Zap, Check, Loader2 } from 'lucide-react';
import { ethers } from 'ethers';
import { parseEther } from 'viem';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { CONTRACT_ADDRESS, GAME_CONFIG } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';
import { useBurnerWallet } from '@/hooks';
import { encryptKey } from '@/lib/encryption';
import { getEthPrice, usdToEth } from '@/lib/price';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type DepositStep = 'select' | 'depositing' | 'creating-burner' | 'transferring' | 'registering' | 'done' | 'error';

const DepositModal: React.FC<DepositModalProps> = ({ isOpen, onClose }) => {
  const { address } = useAccount();
  const [selectedPackage, setSelectedPackage] = useState<1 | 2>(1);
  const [ethPrice, setEthPrice] = useState<number | null>(null);
  const [isPriceLoading, setIsPriceLoading] = useState(true);
  const [step, setStep] = useState<DepositStep>('select');
  const [error, setError] = useState<string | null>(null);
  const [newBurnerAddress, setNewBurnerAddress] = useState<string | null>(null);
  const [depositTxHash, setDepositTxHash] = useState<`0x${string}` | undefined>(undefined);

  const { createBurner, getBurner } = useBurnerWallet();
  const { writeContract, data: txHash, isPending: isWritePending, error: writeError } = useWriteContract();
  
  // Отслеживаем транзакцию депозита
  const { isLoading: isConfirming, isSuccess: depositConfirmed, isError: depositFailed } = useWaitForTransactionReceipt({
    hash: depositTxHash,
  });

  const packages = GAME_CONFIG.packages;
  const ethAmount = ethPrice ? usdToEth(packages[selectedPackage].usd, ethPrice) : '0';

  // Загрузка цены ETH при открытии
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
          setError('Не удалось получить курс ETH. Попробуйте позже.');
          setIsPriceLoading(false);
        });
    }
  }, [isOpen]);

  // Сброс состояния при открытии модала
  useEffect(() => {
    if (isOpen) {
      setStep('select');
      setError(null);
      setNewBurnerAddress(null);
      setDepositTxHash(undefined);
    }
  }, [isOpen]);

  // Отслеживаем хэш транзакции
  useEffect(() => {
    if (txHash && step === 'depositing') {
      setDepositTxHash(txHash);
    }
  }, [txHash, step]);

  // Обработка ошибки writeContract
  useEffect(() => {
    if (writeError && step === 'depositing') {
      console.error('Write contract error:', writeError);
      // Проверяем на отмену пользователем
      const errorMessage = writeError.message || '';
      if (errorMessage.includes('User rejected') || errorMessage.includes('user rejected')) {
        setError('Транзакция отменена');
      } else {
        setError('Ошибка депозита: ' + (writeError.message || 'Неизвестная ошибка'));
      }
      setStep('error');
    }
  }, [writeError, step]);

  // Обработка подтверждения депозита
  useEffect(() => {
    if (depositConfirmed && step === 'depositing') {
      createBurnerAndRegister();
    }
  }, [depositConfirmed, step]);

  // Обработка ошибки транзакции
  useEffect(() => {
    if (depositFailed && step === 'depositing') {
      setError('Транзакция депозита не прошла');
      setStep('error');
    }
  }, [depositFailed, step]);

  const handleDeposit = async () => {
    if (!address) {
      setError('Кошелек не подключен');
      return;
    }
    if (!ethPrice) {
      setError('Курс ETH не загружен');
      return;
    }

    setError(null);
    setStep('depositing');

    try {
      writeContract({
        address: CONTRACT_ADDRESS,
        abi: BASION_ABI,
        functionName: 'deposit',
        args: [BigInt(selectedPackage)],
        value: parseEther(ethAmount),
      });
    } catch (err) {
      console.error('Deposit error:', err);
      setError('Не удалось отправить транзакцию');
      setStep('error');
    }
  };

  const createBurnerAndRegister = useCallback(async () => {
    if (!address || !ethPrice) return;

    try {
      setStep('creating-burner');

      // Проверяем есть ли уже burner, если да - используем его
      let burner = getBurner();
      if (!burner) {
        burner = createBurner();
      }
      setNewBurnerAddress(burner.address);

      // Вычисляем 70% для перевода на burner
      const totalWei = parseEther(ethAmount);
      const forBurner = (totalWei * 70n) / 100n;

      // Проверяем наличие провайдера
      if (!window.ethereum) {
        throw new Error('Кошелек не найден. Установите MetaMask или Rabby.');
      }

      setStep('transferring');

      // Переводим ETH на burner
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const transferTx = await signer.sendTransaction({
        to: burner.address,
        value: forBurner,
      });
      await transferTx.wait();

      setStep('registering');

      // Регистрируем burner в контракте
      writeContract({
        address: CONTRACT_ADDRESS,
        abi: BASION_ABI,
        functionName: 'registerBurner',
        args: [burner.address as `0x${string}`],
      });

      // Отправляем зашифрованный ключ на бэкенд
      try {
        const encrypted = encryptKey(burner.privateKey);
        const response = await fetch('/api/register-burner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mainWallet: address,
            burnerWallet: burner.address,
            encryptedKey: encrypted,
          }),
        });
        
        if (!response.ok) {
          console.error('Backend registration failed:', await response.text());
        }
      } catch (err) {
        console.error('Failed to register burner on backend:', err);
        // Не прерываем поток - основная логика работает
      }

      setStep('done');

      // Автоматическое закрытие после успеха
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      console.error('Burner setup error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Неизвестная ошибка';
      
      // Проверяем на отмену пользователем
      if (errorMessage.includes('User rejected') || errorMessage.includes('user rejected')) {
        setError('Транзакция отменена');
      } else {
        setError('Ошибка настройки: ' + errorMessage);
      }
      setStep('error');
    }
  }, [address, ethPrice, ethAmount, getBurner, createBurner, writeContract, onClose]);

  const getStepContent = () => {
    switch (step) {
      case 'select':
        return (
          <>
            <div className="flex flex-col items-center mb-8">
              <div className="w-14 h-14 bg-[#0052FF] rounded-full flex items-center justify-center mb-4 shadow-lg shadow-blue-900/50 border border-white/20">
                <Wallet className="text-white" size={28} />
              </div>
              <h2 className="text-3xl font-black text-white drop-shadow-md">Купить Тапы</h2>
            </div>

            {isPriceLoading ? (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-4" />
                <p className="text-white/60">Загрузка курса ETH...</p>
              </div>
            ) : error ? (
              <div className="text-center py-8">
                <p className="text-red-400">{error}</p>
                <button
                  onClick={() => {
                    setError(null);
                    setIsPriceLoading(true);
                    getEthPrice()
                      .then(setEthPrice)
                      .catch(() => setError('Не удалось загрузить курс'))
                      .finally(() => setIsPriceLoading(false));
                  }}
                  className="mt-4 px-4 py-2 bg-white/10 rounded-lg text-white hover:bg-white/20"
                >
                  Попробовать снова
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 mb-8">
                  {([1, 2] as const).map((pkg) => (
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

                <p className="text-center text-white/60 mb-4">
                  К оплате: <span className="text-white font-bold">{ethAmount} ETH</span>
                </p>

                <button
                  onClick={handleDeposit}
                  disabled={isWritePending || isConfirming || !ethPrice}
                  className="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 rounded-xl font-bold text-lg text-white shadow-lg shadow-blue-600/30 transform transition active:scale-95 border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isWritePending || isConfirming ? 'Обработка...' : 'Подтвердить покупку'}
                </button>
              </>
            )}
          </>
        );

      case 'depositing':
        return (
          <div className="text-center py-8">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
            <p className="text-white text-lg">Обработка депозита...</p>
            <p className="text-white/60 text-sm mt-2">Подтвердите транзакцию в кошельке</p>
          </div>
        );

      case 'creating-burner':
        return (
          <div className="text-center py-8">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
            <p className="text-white text-lg">Создание tap-кошелька...</p>
            <p className="text-white/60 text-sm mt-2">Этот кошелек будет подписывать тапы автоматически</p>
          </div>
        );

      case 'transferring':
        return (
          <div className="text-center py-8">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
            <p className="text-white text-lg">Перевод средств на tap-кошелек...</p>
            <p className="text-white/60 text-sm mt-2">Подтвердите перевод в кошельке</p>
          </div>
        );

      case 'registering':
        return (
          <div className="text-center py-8">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
            <p className="text-white text-lg">Регистрация tap-кошелька...</p>
            <p className="text-white/60 text-sm mt-2">Подтвердите регистрацию в кошельке</p>
          </div>
        );

      case 'done':
        return (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-white" />
            </div>
            <p className="text-green-400 text-xl font-bold">Готово к игре!</p>
            {newBurnerAddress && (
              <p className="text-white/60 text-xs mt-4 font-mono">
                Tap-кошелек: {newBurnerAddress.slice(0, 10)}...{newBurnerAddress.slice(-8)}
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
            <p className="text-red-400 text-xl font-bold">Что-то пошло не так</p>
            <p className="text-white/60 text-sm mt-2">{error}</p>
            <button
              onClick={() => {
                setStep('select');
                setError(null);
              }}
              className="mt-4 px-6 py-2 bg-white/10 rounded-lg text-white hover:bg-white/20"
            >
              Попробовать снова
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

            {step === 'select' && !isPriceLoading && !error && (
              <button onClick={onClose} className="mt-4 w-full py-2 text-white/50 hover:text-white/70">
                Отмена
              </button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default DepositModal;
