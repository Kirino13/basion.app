'use client';

import React, { useState, useCallback, useEffect, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, CircleDollarSign, Zap, Rocket, Send } from 'lucide-react';
import { useAccount } from 'wagmi';
import { CloudBackground, WalletConnect, TapArea, DepositModal, Leaderboard } from '@/components';
import { useBasionContract, useReferral } from '@/hooks';

function HomeContent() {
  const { address, isConnected } = useAccount();
  const { tapBalance, points, refetchGameStats } = useBasionContract();
  const { generateReferralLink } = useReferral();
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  
  // Boost states
  const [boostPercent, setBoostPercent] = useState<number | null>(null);
  const [boostCode, setBoostCode] = useState('');
  const [isApplyingCode, setIsApplyingCode] = useState(false);
  const [boostMessage, setBoostMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  // Fetch boost percent when address changes
  useEffect(() => {
    if (address) {
      fetch(`/api/boost?address=${address}`)
        .then(res => res.json())
        .then(data => setBoostPercent(data.boostPercent ?? 0))
        .catch(() => setBoostPercent(0));
    } else {
      setBoostPercent(null);
    }
  }, [address]);

  // Clear boost message after 3 seconds
  useEffect(() => {
    if (boostMessage) {
      const timer = setTimeout(() => setBoostMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [boostMessage]);

  // Apply boost code
  const handleApplyCode = async () => {
    if (!address || !boostCode.trim() || isApplyingCode) return;
    
    setIsApplyingCode(true);
    setBoostMessage(null);
    
    try {
      const res = await fetch('/api/boost/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, code: boostCode.trim() }),
      });
      
      const data = await res.json();
      
      if (data.ok) {
        setBoostPercent(data.boostPercent);
        setBoostCode('');
        setBoostMessage({ type: 'success', text: `+${data.addedBoost}% applied!` });
      } else {
        const errorText = data.error === 'INVALID_CODE' ? 'Invalid code' 
          : data.error === 'CODE_ALREADY_USED' ? 'Code already used'
          : 'Failed to apply';
        setBoostMessage({ type: 'error', text: errorText });
      }
    } catch {
      setBoostMessage({ type: 'error', text: 'Network error' });
    } finally {
      setIsApplyingCode(false);
    }
  };

  // Refetch stats when tap succeeds (blockchain confirmed)
  const handleTapSuccess = useCallback(() => {
    refetchGameStats();
  }, [refetchGameStats]);

  // Called when deposit is successful
  const handleDepositSuccess = useCallback(async () => {
    // Refetch with retries to ensure UI updates
    await refetchGameStats(3, 1000);
  }, [refetchGameStats]);

  const handleInvite = async () => {
    if (!address) return;
    const link = generateReferralLink(address);
    await navigator.clipboard.writeText(link);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  return (
    <div className="relative w-full min-h-screen font-sans text-slate-800 overflow-hidden bg-sky-200 select-none">
      <CloudBackground />

      {/* Deposit Modal */}
      <DepositModal 
        isOpen={isDepositOpen} 
        onClose={() => setIsDepositOpen(false)} 
        onDepositSuccess={handleDepositSuccess}
      />

      {/* Main Split Layout */}
      <div className="relative z-10 w-full min-h-screen flex flex-col lg:flex-row">
        {/* LEFT ZONE (65%): The Game */}
        <div className="flex-[6.5] relative flex flex-col items-center justify-center p-6">
          <div className="flex flex-col items-center gap-6 w-full max-w-xl mb-12">
            {/* The Main Tap Area */}
            {isConnected ? (
              <TapArea onOpenDeposit={() => setIsDepositOpen(true)} onTapSuccess={handleTapSuccess} />
            ) : (
              <div className="flex flex-col items-center gap-6">
                {/* Placeholder - entire white block visible, no text */}
                {/* Size increased by 15% to match TapArea */}
                <div className="relative w-[294px] h-[294px] lg:w-[332px] lg:h-[332px] bg-white/60 rounded-[56px] shadow-[0_20px_60px_rgba(0,0,0,0.18)]">
                  {/* Blue square inside */}
                  <div className="absolute inset-[80px] lg:inset-[90px] bg-[rgba(0,0,255,0.5)] rounded-[18px]" />
                </div>
              </div>
            )}

            {/* Bottom Action Area - buttons increased by 30% */}
            <div className="w-full flex flex-col px-2 mt-16 gap-3">
              {/* Row 1: Deposit / Taps / Invite */}
              <div className="w-full flex flex-row items-center justify-center gap-3">
                {/* Deposit Button */}
                <button
                  onClick={() => setIsDepositOpen(true)}
                  className="flex-1 bg-white hover:bg-white/90 py-4 px-4 rounded-2xl font-bold text-base text-slate-900 shadow-xl shadow-blue-900/10 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <CircleDollarSign size={22} className="text-blue-600" />
                  Deposit
                </button>

                {/* Tap Balance Display */}
                <button
                  onClick={() => setIsDepositOpen(true)}
                  className="flex-1 bg-white py-4 px-4 rounded-2xl font-bold text-base text-slate-900 shadow-xl shadow-blue-900/10 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <Zap size={22} fill="currentColor" className="text-yellow-500" />
                  <motion.span key={tapBalance} initial={{ scale: 1.1 }} animate={{ scale: 1 }}>
                    {tapBalance.toLocaleString().replace(/,/g, ' ')}
                  </motion.span>
                </button>

                {/* Invite Button */}
                <button
                  onClick={handleInvite}
                  disabled={!isConnected}
                  className={`flex-1 py-4 px-4 rounded-2xl font-bold text-base shadow-xl shadow-blue-900/10 transition-all active:scale-95 flex items-center justify-center gap-2 ${
                    inviteCopied
                      ? 'bg-green-500 text-white'
                      : 'bg-white hover:bg-white/90 text-slate-900 disabled:opacity-50'
                  }`}
                >
                  <AnimatePresence mode="wait">
                    {inviteCopied ? (
                      <motion.div
                        key="copied"
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="flex items-center gap-2"
                      >
                        <Check size={22} /> Copied!
                      </motion.div>
                    ) : (
                      <motion.div
                        key="invite"
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="flex items-center gap-2"
                      >
                        <Copy size={22} className="text-blue-600" /> Invite
                      </motion.div>
                    )}
                  </AnimatePresence>
                </button>
              </div>

              {/* Row 2: Boost Button / Code Input */}
              <div className="w-full flex flex-row items-center justify-center gap-3">
                {/* Boost Button */}
                <button
                  className="flex-1 bg-white py-4 px-4 rounded-2xl font-bold text-base text-slate-900 shadow-xl shadow-blue-900/10 transition-all flex items-center justify-center gap-2 cursor-default"
                  title="Your boost is applied to points"
                >
                  <Rocket size={22} className="text-blue-600" />
                  <span>
                    Boost {boostPercent === null ? '--' : boostPercent}%
                  </span>
                </button>

                {/* Code Input + Apply */}
                <div className="flex-1 bg-white py-2 px-3 rounded-2xl shadow-xl shadow-blue-900/10 flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Code for Boost"
                    value={boostCode}
                    onChange={(e) => setBoostCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && handleApplyCode()}
                    disabled={!isConnected || isApplyingCode}
                    className="flex-1 bg-transparent text-slate-900 font-bold text-base placeholder:text-slate-400 outline-none min-w-0 py-2"
                  />
                  <button
                    onClick={handleApplyCode}
                    disabled={!isConnected || !boostCode.trim() || isApplyingCode}
                    className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-300 disabled:cursor-not-allowed p-2 rounded-xl transition-all active:scale-95"
                  >
                    {isApplyingCode ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Send size={20} className="text-white" />
                    )}
                  </button>
                </div>
              </div>

              {/* Boost Message */}
              <AnimatePresence>
                {boostMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className={`text-center text-sm font-medium ${
                      boostMessage.type === 'success' ? 'text-green-600' : 'text-red-500'
                    }`}
                  >
                    {boostMessage.text}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Footer Social Button */}
          <div className="absolute bottom-6 left-6">
            <a
              href="https://x.com/basion_tap"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white/40 hover:bg-white/60 backdrop-blur-md w-16 h-16 rounded-full text-slate-800 transition-all shadow-lg shadow-blue-900/10 flex items-center justify-center group"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="w-8 h-8 fill-black group-hover:scale-110 transition-transform"
              >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path>
              </svg>
            </a>
          </div>
        </div>

        {/* RIGHT ZONE (35%): HUD & Leaderboard */}
        <div className="flex-[3.5] lg:max-w-md w-full relative flex flex-col p-6 lg:py-8 lg:pr-8 lg:pl-0 min-h-0 mx-auto lg:mx-0">
          {/* Top Row */}
          <div className="grid grid-cols-2 gap-4 mt-2 mb-6 w-full">
            {/* Points Badge */}
            <div className="bg-green-500 rounded-xl py-3 flex flex-col justify-center items-center shadow-lg shadow-green-500/30">
              <span className="text-lg font-bold text-white tracking-wide">{points.toLocaleString()} pts</span>
            </div>

            {/* Connect Wallet */}
            <WalletConnect />
          </div>

          {/* Leaderboard */}
          <div className="flex-1 min-h-0 w-full mb-4">
            <Leaderboard currentUserPoints={points} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="w-full min-h-screen bg-sky-200 flex items-center justify-center">
          <div className="text-slate-800 text-xl">Loading...</div>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
