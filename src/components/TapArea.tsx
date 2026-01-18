'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useBurnerWallet, useTapThrottle, useBasionContract } from '@/hooks';
import { FloatingText } from '@/types';
import FloatingBubble from './FloatingBubble';

interface TapAreaProps {
  onOpenDeposit: () => void;
}

const TapArea: React.FC<TapAreaProps> = ({ onOpenDeposit }) => {
  const [bubbles, setBubbles] = useState<FloatingText[]>([]);
  const [localTaps, setLocalTaps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const { hasBurner, sendTap } = useBurnerWallet();
  const { canTap, recordTap, completeTap } = useTapThrottle();
  const { tapBalance, points, totalTaps, isConnected, address, refetchGameStats } = useBasionContract();

  // Синхронизация локального состояния с контрактом
  useEffect(() => {
    setLocalTaps(tapBalance);
  }, [tapBalance]);

  // Синхронизация очков с Supabase при загрузке (один раз)
  const [hasSynced, setHasSynced] = useState(false);
  
  useEffect(() => {
    // Синхронизируем только один раз при загрузке, если есть адрес и данные загружены
    if (address && !hasSynced && tapBalance >= 0) {
      const timer = setTimeout(async () => {
        try {
          await fetch('/api/sync-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mainWallet: address,
              points: points,
              totalTaps: totalTaps,
              tapBalance: tapBalance,
            }),
          });
          setHasSynced(true);
        } catch (syncError) {
          console.error('Failed to sync user stats on load:', syncError);
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [address, hasSynced, points, totalTaps, tapBalance]);

  // Автоочистка ошибки через 3 секунды
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const removeBubble = useCallback((id: number) => {
    setBubbles((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const handleTap = useCallback(
    async (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
      // Очищаем предыдущую ошибку
      setError(null);

      // Проверка подключения
      if (!isConnected) {
        setError('Подключите кошелек');
        return;
      }

      // Проверка burner кошелька
      if (!hasBurner) {
        setError('Сначала пополните баланс');
        onOpenDeposit();
        return;
      }

      // Проверка баланса тапов
      if (localTaps <= 0) {
        setError('Закончились тапы! Купите еще.');
        onOpenDeposit();
        return;
      }

      // Проверка кулдауна
      if (!canTap()) {
        return; // Молча игнорируем слишком быстрые тапы
      }

      // Проверка что не обрабатываем другой тап
      if (isProcessing) {
        return;
      }

      // Получаем позицию клика
      let clientX: number, clientY: number;
      if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      // Начинаем тап
      setIsProcessing(true);
      recordTap();

      // Создаем анимацию пузырька
      const newBubble: FloatingText = {
        id: Date.now() + Math.random(),
        x: clientX,
        y: clientY,
        value: 1,
      };
      setBubbles((prev) => [...prev, newBubble]);

      // Оптимистичное обновление UI
      setLocalTaps((prev) => Math.max(0, prev - 1));

      try {
        // Отправляем транзакцию тапа через burner кошелек
        await sendTap();

        // Обновляем состояние с контракта через 2 секунды и синхронизируем с Supabase
        setTimeout(async () => {
          const result = await refetchGameStats();
          
          // Синхронизируем очки с Supabase используя актуальные данные
          if (address && result.data) {
            const data = result.data as [bigint, bigint, bigint, string];
            const syncData = {
              mainWallet: address,
              points: Number(data[1]),      // points - второй элемент
              totalTaps: Number(data[2]),   // totalTaps - третий элемент  
              tapBalance: Number(data[0]),  // tapBalance - первый элемент
            };
            console.log('Syncing user data to Supabase:', syncData);
            try {
              const response = await fetch('/api/sync-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(syncData),
              });
              const responseData = await response.json();
              console.log('Sync response:', responseData);
            } catch (syncError) {
              console.error('Failed to sync user stats:', syncError);
            }
          } else {
            console.log('Skipping sync - no address or data:', { address, hasData: !!result.data });
          }
        }, 2000);
      } catch (err) {
        console.error('Tap error:', err);
        
        // Анализируем ошибку
        const errorMessage = err instanceof Error ? err.message : 'Неизвестная ошибка';
        
        if (errorMessage.includes('insufficient funds') || errorMessage.includes('gas')) {
          setError('Недостаточно ETH для газа на tap-кошельке');
        } else if (errorMessage.includes('No burner')) {
          setError('Tap-кошелек не найден');
        } else if (errorMessage.includes('nonce')) {
          setError('Слишком много тапов. Подождите.');
        } else {
          setError('Тап не прошел. Попробуйте снова.');
        }

        // Откатываем оптимистичное обновление
        setLocalTaps((prev) => prev + 1);
      } finally {
        setIsProcessing(false);
        completeTap();
      }
    },
    [isConnected, hasBurner, localTaps, canTap, isProcessing, sendTap, recordTap, completeTap, refetchGameStats, onOpenDeposit, address]
  );

  const isDisabled = !isConnected || !hasBurner || localTaps <= 0;

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-xl">
      {/* Анимированные пузырьки */}
      {bubbles.map((b) => (
        <FloatingBubble key={b.id} data={b} onComplete={removeBubble} />
      ))}

      {/* Отображение тапов */}
      <div className="text-center">
        <p className="text-4xl font-bold text-white drop-shadow-md">{localTaps.toLocaleString().replace(/,/g, ' ')}</p>
        <p className="text-white/70 text-sm">Тапов осталось</p>
      </div>

      {/* Квадратная кнопка TAP - весь белый блок кликабелен */}
      <motion.div
        whileHover={{ scale: isDisabled ? 1 : 1.02 }}
        whileTap={{ scale: isDisabled ? 1 : 0.95 }}
        onClick={handleTap}
        onTouchStart={handleTap}
        className={`relative w-64 h-64 lg:w-72 lg:h-72 bg-white rounded-[48px] shadow-[0_18px_50px_rgba(0,0,0,0.15)] select-none ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {/* Синий квадрат внутри */}
        <div 
          className="absolute inset-[70px] bg-[#0000FF] rounded-[16px] pointer-events-none"
        />
      </motion.div>

      {/* Сообщение об ошибке */}
      {error && (
        <motion.p 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="text-red-500 text-sm bg-red-50/80 px-4 py-2 rounded-lg"
        >
          {error}
        </motion.p>
      )}
    </div>
  );
};

export default TapArea;
