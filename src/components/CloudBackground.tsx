'use client';

import React from 'react';
import { motion } from 'framer-motion';

const CloudBackground: React.FC = () => {
  const cloudLayers = [
    { id: 1, size: 300, top: '10%', duration: 60, delay: 0, opacity: 0.8 },
    { id: 2, size: 400, top: '30%', duration: 80, delay: -20, opacity: 0.6 },
    { id: 3, size: 250, top: '15%', duration: 50, delay: -10, opacity: 0.7 },
    { id: 4, size: 500, top: '50%', duration: 90, delay: -40, opacity: 0.4 },
    { id: 5, size: 350, top: '5%', duration: 70, delay: -5, opacity: 0.5 },
  ];

  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none bg-gradient-to-b from-sky-400 via-sky-300 to-blue-100">
      {/* Sun Glow */}
      <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-gradient-radial from-yellow-200/40 to-transparent blur-[80px]" />

      {/* Drifting Clouds */}
      {cloudLayers.map((cloud) => (
        <motion.div
          key={cloud.id}
          className="absolute rounded-full bg-white blur-xl"
          style={{
            top: cloud.top,
            width: cloud.size,
            height: cloud.size * 0.6,
            opacity: cloud.opacity,
            filter: 'blur(40px)',
          }}
          initial={{ x: '-100%' }}
          animate={{ x: '120vw' }}
          transition={{
            duration: cloud.duration,
            repeat: Infinity,
            ease: 'linear',
            delay: cloud.delay,
          }}
        />
      ))}

      {/* Atmospheric Overlay */}
      <div className="absolute inset-0 bg-white/10 mix-blend-overlay" />
    </div>
  );
};

export default CloudBackground;
