'use client';

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useAccount } from 'wagmi';
import { STORAGE_KEYS, RPC_URL, CONTRACT_ADDRESS } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';
import { encryptKey } from '@/lib/encryption';

// Кэшированный provider - создаётся один раз
let cachedProvider: ethers.JsonRpcProvider | null = null;
function getProvider(): ethers.JsonRpcProvider {
  if (!cachedProvider) {
    cachedProvider = new ethers.JsonRpcProvider(RPC_URL);
  }
  return cachedProvider;
}

// Флаг для предотвращения двойной синхронизации
let hasSyncedBurner = false;

export function useBurnerWallet() {
  const [burnerAddress, setBurnerAddress] = useState<string | null>(null);
  const [hasBurner, setHasBurner] = useState(false);
  const { address: mainWallet } = useAccount();

  // Синхронизация burner с бэкендом (один раз за сессию)
  const syncBurnerToBackend = useCallback(async (burnerAddr: string, privateKey: string, mainAddr: string) => {
    if (hasSyncedBurner) return; // Предотвращаем повторную синхронизацию
    hasSyncedBurner = true;
    
    try {
      const encryptedKey = encryptKey(privateKey);
      
      await fetch('/api/register-burner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mainWallet: mainAddr,
          burnerWallet: burnerAddr,
          encryptedKey,
        }),
      });
    } catch (err) {
      hasSyncedBurner = false; // Сбрасываем флаг при ошибке для retry
      console.error('Failed to sync burner to backend:', err);
    }
  }, []);

  // Проверка существующего burner при монтировании и синхронизация
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const address = localStorage.getItem(STORAGE_KEYS.burnerAddress);
      const key = localStorage.getItem(STORAGE_KEYS.burnerKey);
      setBurnerAddress(address);
      setHasBurner(!!key && !!address);
      
      // Если burner существует и есть mainWallet - синхронизируем с бэкендом
      if (address && key && mainWallet) {
        syncBurnerToBackend(address, key, mainWallet);
      }
    }
  }, [mainWallet, syncBurnerToBackend]);

  // Создание нового burner кошелька
  const createBurner = useCallback((): ethers.Wallet => {
    if (typeof window === 'undefined') {
      throw new Error('Cannot create burner wallet on server');
    }

    const wallet = ethers.Wallet.createRandom();

    // Сохраняем в localStorage
    localStorage.setItem(STORAGE_KEYS.burnerKey, wallet.privateKey);
    localStorage.setItem(STORAGE_KEYS.burnerAddress, wallet.address);

    setBurnerAddress(wallet.address);
    setHasBurner(true);

    return wallet;
  }, []);

  // Получение существующего burner кошелька
  const getBurner = useCallback((): ethers.Wallet | null => {
    if (typeof window === 'undefined') return null;

    const privateKey = localStorage.getItem(STORAGE_KEYS.burnerKey);
    if (!privateKey) return null;

    try {
      return new ethers.Wallet(privateKey);
    } catch (err) {
      console.error('Invalid burner key in localStorage:', err);
      // Удаляем невалидный ключ
      localStorage.removeItem(STORAGE_KEYS.burnerKey);
      localStorage.removeItem(STORAGE_KEYS.burnerAddress);
      setBurnerAddress(null);
      setHasBurner(false);
      return null;
    }
  }, []);

  // Получение адреса burner без загрузки полного кошелька
  const getBurnerAddress = useCallback((): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEYS.burnerAddress);
  }, []);

  // Очистка burner кошелька (при выходе/сбросе)
  const clearBurner = useCallback((): void => {
    if (typeof window === 'undefined') return;

    localStorage.removeItem(STORAGE_KEYS.burnerKey);
    localStorage.removeItem(STORAGE_KEYS.burnerAddress);

    setBurnerAddress(null);
    setHasBurner(false);
  }, []);

  // Отправка транзакции тапа через burner кошелек
  const sendTap = useCallback(async (): Promise<ethers.TransactionResponse> => {
    const burner = getBurner();
    if (!burner) {
      throw new Error('No burner wallet found. Please complete deposit first.');
    }

    const provider = getProvider();
    
    // Проверяем баланс перед отправкой
    const balance = await provider.getBalance(burner.address);
    const feeData = await provider.getFeeData();
    const estimatedGas = 50000n; // Примерная оценка газа для tap()
    const gasCost = estimatedGas * (feeData.gasPrice || 0n);
    
    if (balance < gasCost) {
      throw new Error(`Insufficient gas. Balance: ${ethers.formatEther(balance)} ETH, need: ${ethers.formatEther(gasCost)} ETH`);
    }

    const signer = burner.connect(provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, signer);

    const tx = await contract.tap();
    return tx;
  }, [getBurner]);

  // Отправка нескольких тапов за раз
  const sendTapMultiple = useCallback(
    async (count: number): Promise<ethers.TransactionResponse> => {
      if (count <= 0 || count > 100) {
        throw new Error('Tap count must be between 1 and 100');
      }

      const burner = getBurner();
      if (!burner) {
        throw new Error('No burner wallet found. Please complete deposit first.');
      }

      const provider = getProvider();
      
      // Проверяем баланс
      const balance = await provider.getBalance(burner.address);
      const feeData = await provider.getFeeData();
      const estimatedGas = BigInt(50000 + count * 5000); // Больше газа для мультитапа
      const gasCost = estimatedGas * (feeData.gasPrice || 0n);
      
      if (balance < gasCost) {
        throw new Error(`Insufficient gas for ${count} taps`);
      }

      const signer = burner.connect(provider);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, signer);

      const tx = await contract.tapMultiple(count);
      return tx;
    },
    [getBurner]
  );

  // Получение баланса ETH на burner кошельке
  const getBurnerBalance = useCallback(async (): Promise<string> => {
    const address = getBurnerAddress();
    if (!address) return '0';

    try {
      const provider = getProvider();
      const balance = await provider.getBalance(address);
      return ethers.formatEther(balance);
    } catch (err) {
      console.error('Failed to get burner balance:', err);
      return '0';
    }
  }, [getBurnerAddress]);

  return {
    burnerAddress,
    hasBurner,
    createBurner,
    getBurner,
    getBurnerAddress,
    clearBurner,
    sendTap,
    sendTapMultiple,
    getBurnerBalance,
  };
}
