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
  const [localPoints, setLocalPoints] = useState(0);
  const [localTaps, setLocalTaps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const { hasBurner, sendTap, getBurnerBalance } = useBurnerWallet();
  const { canTap, recordTap, completeTap } = useTapThrottle();
  const { tapBalance, points, isConnected, refetchGameStats } = useBasionContract();

  // Синхронизация локального состояния с контрактом
  useEffect(() => {
    setLocalTaps(tapBalance);
    setLocalPoints(points);
  }, [tapBalance, points]);

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
      setLocalPoints((prev) => prev + 1);

      try {
        // Отправляем транзакцию тапа через burner кошелек
        await sendTap();

        // Обновляем состояние с контракта через 2 секунды
        setTimeout(() => {
          refetchGameStats();
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
        setLocalPoints((prev) => prev - 1);
      } finally {
        setIsProcessing(false);
        completeTap();
      }
    },
    [isConnected, hasBurner, localTaps, canTap, isProcessing, sendTap, recordTap, completeTap, refetchGameStats, onOpenDeposit]
  );

  const isDisabled = !isConnected || !hasBurner || localTaps <= 0;

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-xl">
      {/* Анимированные пузырьки */}
      {bubbles.map((b) => (
        <FloatingBubble key={b.id} data={b} onComplete={removeBubble} />
      ))}

      {/* Отображение статистики */}
      <div className="flex gap-8 text-center">
        <div>
          <p className="text-3xl font-bold text-white drop-shadow-md">{localTaps.toLocaleString()}</p>
          <p className="text-white/70 text-sm">Тапов осталось</p>
        </div>
        <div>
          <p className="text-3xl font-bold text-white drop-shadow-md">{localPoints.toLocaleString()}</p>
          <p className="text-white/70 text-sm">Очков</p>
        </div>
      </div>

      {/* Главный круг для тапов */}
      <motion.div
        whileHover={{ scale: isDisabled ? 1 : 1.05 }}
        whileTap={{ scale: isDisabled ? 1 : 0.95 }}
        onClick={handleTap}
        onTouchStart={handleTap}
        className={`relative group ${isDisabled ? 'opacity-50 grayscale cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {/* Свечение при наведении */}
        <div className="absolute inset-0 bg-white/40 rounded-full blur-[60px] opacity-0 group-hover:opacity-100 transition-opacity duration-500 scale-110" />

        {/* Круглая кнопка */}
        <div className="w-64 h-64 lg:w-80 lg:h-80 rounded-full overflow-hidden shadow-2xl relative z-10 bg-gradient-to-br from-[#0052FF] to-[#003ACC] flex items-center justify-center">
          <span className="text-white text-5xl lg:text-6xl font-black select-none">TAP</span>
        </div>
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

      {/* Подсказка о кулдауне */}
      <p className="text-white/50 text-xs">Максимум 2 тапа в секунду</p>
    </div>
  );
};

export default TapArea;
