'use client';

import React, { useState } from 'react';
import { Copy, Check, Users } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useReferral, useBasionContract } from '@/hooks';
import { motion, AnimatePresence } from 'framer-motion';

const ReferralLink: React.FC = () => {
  const { address } = useAccount();
  const { generateReferralLink } = useReferral();
  const { referrer, pointsMultiplier } = useBasionContract();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!address) return;

    const link = generateReferralLink(address);
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!address) return null;

  // Check if user has a referrer (was invited)
  const hasReferrer = referrer && referrer !== '0x0000000000000000000000000000000000000000';
  // Check if user has a boost
  const hasBoost = pointsMultiplier > 100;
  const boostPercent = hasBoost ? Math.round((pointsMultiplier - 100) / 100 * 100) : 0;

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 shadow-lg border border-white/50">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 bg-purple-100 rounded-xl">
          <Users className="w-5 h-5 text-purple-600" />
        </div>
        <h3 className="font-bold text-[#0B1B3A]">Referrals</h3>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="text-center p-2 bg-white/50 rounded-lg">
          <p className={`text-lg font-bold ${hasBoost ? 'text-[#0052FF]' : 'text-gray-400'}`}>
            {hasBoost ? `+${boostPercent}%` : 'None'}
          </p>
          <p className="text-xs text-gray-500">Your Boost</p>
        </div>
        <div className="text-center p-2 bg-white/50 rounded-lg">
          <p className={`text-lg font-bold ${hasReferrer ? 'text-green-500' : 'text-gray-400'}`}>
            {hasReferrer ? 'Yes' : 'No'}
          </p>
          <p className="text-xs text-gray-500">Invited</p>
        </div>
      </div>

      {/* Copy Button */}
      <button
        onClick={handleCopy}
        className={`w-full py-3 rounded-xl font-bold text-sm shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${
          copied ? 'bg-green-500 text-white' : 'bg-white hover:bg-gray-50 text-[#0B1B3A]'
        }`}
      >
        <AnimatePresence mode="wait">
          {copied ? (
            <motion.div
              key="copied"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex items-center gap-2"
            >
              <Check size={18} /> Copied!
            </motion.div>
          ) : (
            <motion.div
              key="copy"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex items-center gap-2"
            >
              <Copy size={18} /> Copy Invite Link +10%
            </motion.div>
          )}
        </AnimatePresence>
      </button>

      <p className="text-xs text-center text-gray-500 mt-2">
        Invite friends and both get bonus boosts!
      </p>
    </div>
  );
};

export default ReferralLink;
