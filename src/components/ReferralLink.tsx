'use client';

import React, { useState } from 'react';
import { Copy, Check, Users } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useReferral, useBasionContract } from '@/hooks';
import { motion, AnimatePresence } from 'framer-motion';

const ReferralLink: React.FC = () => {
  const { address } = useAccount();
  const { generateReferralLink } = useReferral();
  const { referralActive, referralBonus, referralCount } = useBasionContract();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!address) return;

    const link = generateReferralLink(address);
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!address) return null;

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 shadow-lg border border-white/50">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 bg-purple-100 rounded-xl">
          <Users className="w-5 h-5 text-purple-600" />
        </div>
        <h3 className="font-bold text-[#0B1B3A]">Referrals</h3>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="text-center p-2 bg-white/50 rounded-lg">
          <p className="text-lg font-bold text-[#0B1B3A]">{referralCount}</p>
          <p className="text-xs text-gray-500">Invited</p>
        </div>
        <div className="text-center p-2 bg-white/50 rounded-lg">
          <p className="text-lg font-bold text-[#0052FF]">+{referralBonus}</p>
          <p className="text-xs text-gray-500">Bonus</p>
        </div>
        <div className="text-center p-2 bg-white/50 rounded-lg">
          <p className={`text-lg font-bold ${referralActive ? 'text-green-500' : 'text-gray-400'}`}>
            {referralActive ? 'Active' : 'Inactive'}
          </p>
          <p className="text-xs text-gray-500">Status</p>
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
              <Copy size={18} /> Copy Invite Link
            </motion.div>
          )}
        </AnimatePresence>
      </button>

      <p className="text-xs text-center text-gray-500 mt-2">
        Earn bonus points when friends tap!
      </p>
    </div>
  );
};

export default ReferralLink;
