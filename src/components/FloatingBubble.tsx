'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { FloatingText } from '@/types';

interface FloatingBubbleProps {
  data: FloatingText;
  onComplete: (id: number) => void;
}

const FloatingBubble: React.FC<FloatingBubbleProps> = ({ data, onComplete }) => {
  // Random offsets for particles
  const particles = [
    { delay: 0.1, x: -8, duration: 1.2 },
    { delay: 0.2, x: 6, duration: 1.0 },
    { delay: 0.3, x: -4, duration: 1.1 },
  ];

  return (
    <motion.div
      className="fixed pointer-events-none z-50"
      style={{ left: data.x, top: data.y }}
      initial={{ opacity: 0, y: 0, scale: 0.5 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
    >
      {/* Main bubble */}
      <motion.div
        className="relative flex items-center justify-center"
        initial={{ scale: 0.85 }}
        animate={{ 
          scale: [0.85, 1.1, 1.0],
          y: [0, -160],
          opacity: [1, 1, 0]
        }}
        transition={{ 
          duration: 1.8,
          times: [0, 0.15, 1],
          ease: 'easeOut'
        }}
        onAnimationComplete={() => onComplete(data.id)}
      >
        {/* Bubble container with gradient and glow */}
        <div 
          className="relative w-12 h-12 rounded-full flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #00E5FF 0%, #0052FF 100%)',
            boxShadow: '0 0 12px rgba(0,229,255,0.75), 0 0 24px rgba(0,82,255,0.35), inset 0 1px 2px rgba(255,255,255,0.4)',
            border: '2px solid rgba(255,255,255,0.9)',
          }}
        >
          {/* Top glare */}
          <div 
            className="absolute top-1 left-1/2 -translate-x-1/2 w-6 h-3 rounded-full"
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 100%)',
            }}
          />
          
          {/* +1 Text */}
          <span 
            className="relative z-10 font-black text-lg select-none"
            style={{
              color: '#FFFFFF',
              textShadow: '0 1px 2px rgba(0,0,0,0.3), 0 0 8px rgba(0,229,255,0.6)',
            }}
          >
            +{data.value}
          </span>
        </div>

        {/* Energy particles (trail) */}
        {particles.map((particle, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              width: 6 + Math.random() * 4,
              height: 6 + Math.random() * 4,
              background: 'linear-gradient(135deg, #00E5FF 0%, #0052FF 100%)',
              boxShadow: '0 0 6px rgba(0,229,255,0.5)',
              left: '50%',
              top: '100%',
            }}
            initial={{ 
              opacity: 0.5, 
              scale: 0.8,
              x: particle.x,
              y: 0
            }}
            animate={{ 
              opacity: 0, 
              scale: 0.3,
              x: particle.x * 1.5,
              y: 20
            }}
            transition={{ 
              duration: particle.duration,
              delay: particle.delay,
              ease: 'easeOut'
            }}
          />
        ))}
      </motion.div>
    </motion.div>
  );
};

export default React.memo(FloatingBubble);
