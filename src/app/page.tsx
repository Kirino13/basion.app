'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, CircleDollarSign, Zap } from 'lucide-react';
import { useAccount } from 'wagmi';
import { CloudBackground, WalletConnect, TapArea, DepositModal, Leaderboard } from '@/components';
import { useBasionContract, useReferral } from '@/hooks';

// Separate component for referral handling to use useSearchParams
function ReferralHandler() {
  const { address } = useAccount();
  const { storedReferrer, clearReferrer } = useReferral();
  const { setReferrer, referrer: contractReferrer, totalTaps, isConnected } = useBasionContract();

  // Handle referral setup when wallet connects
  useEffect(() => {
    // Only set referrer if:
    // 1. Wallet is connected
    // 2. There's a stored referrer from URL
    // 3. User hasn't started tapping yet
    // 4. User doesn't already have a referrer set
    if (
      isConnected &&
      storedReferrer &&
      totalTaps === 0 &&
      (!contractReferrer || contractReferrer === '0x0000000000000000000000000000000000000000')
    ) {
      // Set referrer on contract
      setReferrer(storedReferrer as `0x${string}`);
      clearReferrer();
    }
  }, [isConnected, storedReferrer, totalTaps, contractReferrer, setReferrer, clearReferrer]);

  return null;
}

function HomeContent() {
  const { address, isConnected } = useAccount();
  const { tapBalance, points } = useBasionContract();
  const { generateReferralLink } = useReferral();
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

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

      {/* Referral Handler */}
      <Suspense fallback={null}>
        <ReferralHandler />
      </Suspense>

      {/* Deposit Modal */}
      <DepositModal isOpen={isDepositOpen} onClose={() => setIsDepositOpen(false)} />

      {/* Main Split Layout */}
      <div className="relative z-10 w-full min-h-screen flex flex-col lg:flex-row">
        {/* LEFT ZONE (65%): The Game */}
        <div className="flex-[6.5] relative flex flex-col items-center justify-center p-6">
          <div className="flex flex-col items-center gap-6 w-full max-w-xl mb-12">
            {/* The Main Tap Area */}
            {isConnected ? (
              <TapArea onOpenDeposit={() => setIsDepositOpen(true)} />
            ) : (
              <div className="flex flex-col items-center gap-6">
                {/* Placeholder - entire white block visible */}
                <div className="relative w-64 h-64 lg:w-72 lg:h-72 bg-white/60 rounded-[48px] shadow-[0_18px_50px_rgba(0,0,0,0.15)] flex items-center justify-center">
                  {/* Blue square inside */}
                  <div className="absolute inset-[70px] bg-[rgba(0,0,255,0.5)] rounded-[16px]" />
                  <span className="text-white/80 text-lg font-bold relative z-10">Connect to Play</span>
                </div>
              </div>
            )}

            {/* Bottom Action Area */}
            <div className="w-full flex flex-col px-2">
              <div className="w-full flex flex-row items-center justify-center gap-2">
                {/* Deposit Button */}
                <button
                  onClick={() => setIsDepositOpen(true)}
                  className="flex-1 bg-white hover:bg-white/90 py-3 rounded-xl font-bold text-sm text-slate-900 shadow-xl shadow-blue-900/10 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <CircleDollarSign size={18} className="text-blue-600" />
                  Deposit
                </button>

                {/* Tap Balance Display */}
                <button
                  onClick={() => setIsDepositOpen(true)}
                  className="flex-1 bg-white py-3 rounded-xl font-bold text-sm text-slate-900 shadow-xl shadow-blue-900/10 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <Zap size={18} fill="currentColor" className="text-yellow-500" />
                  <motion.span key={tapBalance} initial={{ scale: 1.1 }} animate={{ scale: 1 }}>
                    {tapBalance.toLocaleString().replace(/,/g, ' ')}
                  </motion.span>
                </button>

                {/* Invite Button */}
                <button
                  onClick={handleInvite}
                  disabled={!isConnected}
                  className={`flex-1 py-3 rounded-xl font-bold text-sm shadow-xl shadow-blue-900/10 transition-all active:scale-95 flex items-center justify-center gap-2 ${
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
                        <Check size={18} /> Copied!
                      </motion.div>
                    ) : (
                      <motion.div
                        key="invite"
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="flex items-center gap-2"
                      >
                        <Copy size={18} className="text-blue-600" /> Invite
                      </motion.div>
                    )}
                  </AnimatePresence>
                </button>
              </div>
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
