'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { FloatingText } from '@/types';

interface FloatingBubbleProps {
  data: FloatingText;
  onComplete: (id: number) => void;
}

const FloatingBubble: React.FC<FloatingBubbleProps> = ({ data, onComplete }) => {
  return (
    <motion.div
      className="fixed pointer-events-none z-50 font-bold text-2xl text-white drop-shadow-lg"
      style={{ left: data.x, top: data.y }}
      initial={{ opacity: 1, y: 0, scale: 1 }}
      animate={{ opacity: 0, y: -100, scale: 1.5 }}
      transition={{ duration: 0.8, ease: 'easeOut' }}
      onAnimationComplete={() => onComplete(data.id)}
    >
      +{data.value}
    </motion.div>
  );
};

export default FloatingBubble;
