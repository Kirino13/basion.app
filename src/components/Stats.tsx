'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';

interface StatsProps {
  tapBalance: number;
  points: number;
  onOpenDeposit?: () => void;
}

const Stats: React.FC<StatsProps> = ({ tapBalance, points, onOpenDeposit }) => {
  return (
    <div className="grid grid-cols-2 gap-4 w-full">
      {/* Points Badge */}
      <div className="bg-green-500 rounded-xl py-3 flex flex-col justify-center items-center shadow-lg shadow-green-500/30">
        <span className="text-lg font-bold text-white tracking-wide">
          {points.toLocaleString()} pts
        </span>
      </div>

      {/* Tap Balance */}
      <button
        onClick={onOpenDeposit}
        className="bg-white py-3 rounded-xl font-bold text-sm text-slate-900 shadow-xl shadow-blue-900/10 transition-all active:scale-95 flex items-center justify-center gap-2"
      >
        <Zap size={18} fill="currentColor" className="text-yellow-500" />
        <motion.span key={tapBalance} initial={{ scale: 1.1 }} animate={{ scale: 1 }}>
          {tapBalance.toLocaleString().replace(/,/g, ' ')}
        </motion.span>
      </button>
    </div>
  );
};

export default Stats;
