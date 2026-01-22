'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Trophy, Users } from 'lucide-react';
import { LeaderboardEntry } from '@/types';

const Leaderboard: React.FC = () => {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    try {
      setError(null);
      // Add timestamp to prevent caching, fetch all 100 entries
      // cache: 'no-store' is sufficient, no need for extra headers
      const res = await fetch(`/api/leaderboard?limit=100&t=${Date.now()}`, {
        cache: 'no-store',
      });
      
      if (!res.ok) {
        throw new Error(`HTTP error: ${res.status}`);
      }
      
      const data = await res.json();
      setEntries(data);
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err);
      setError('Failed to load leaderboard');
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 30000); // Update every 30 sec
    return () => clearInterval(interval);
  }, [fetchLeaderboard]);

  const getRankBadge = useCallback((rank: number) => {
    if (rank === 1) {
      return (
        <div className="w-9 h-9 rounded-full bg-gradient-to-b from-[#FFD36B] to-[#FFB020] shadow-sm border border-yellow-200 flex items-center justify-center text-white text-sm font-black ring-2 ring-white/50">
          1
        </div>
      );
    }
    if (rank === 2) {
      return (
        <div className="w-9 h-9 rounded-full bg-gradient-to-b from-[#E5E7EB] to-[#BFC7D5] shadow-sm border border-slate-300 flex items-center justify-center text-white text-sm font-black ring-2 ring-white/50">
          2
        </div>
      );
    }
    if (rank === 3) {
      return (
        <div className="w-9 h-9 rounded-full bg-gradient-to-b from-[#F2B08A] to-[#C56B42] shadow-sm border border-orange-200 flex items-center justify-center text-white text-sm font-black ring-2 ring-white/50">
          3
        </div>
      );
    }
    return (
      <div className="w-9 h-9 rounded-full bg-white/60 text-[#0B1B3A] text-sm font-bold flex items-center justify-center border border-white/80 shadow-inner">
        {rank}
      </div>
    );
  }, []);

  const formatPoints = useCallback((points: number) => {
    // Show with 1 decimal place if not a whole number, always use dot as decimal separator
    if (points % 1 !== 0) {
      return points.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    }
    return points.toLocaleString('en-US');
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col w-full bg-gradient-to-b from-white/40 to-blue-50/20 backdrop-blur-2xl border border-cyan-400/30 rounded-3xl overflow-hidden shadow-lg ring-1 ring-white/60">
        <div className="px-5 py-4 border-b border-white/50 bg-white/30 flex items-center gap-3 shadow-sm">
          <div className="p-2 bg-cyan-400/10 border border-cyan-400/20 rounded-xl shadow-inner">
            <Trophy className="w-5 h-5 text-[#0052FF]" strokeWidth={2.5} />
          </div>
          <h3 className="text-[#0B1B3A] font-black text-lg tracking-tight">Leaderboard</h3>
        </div>
        <div className="p-8 flex items-center justify-center">
          <div className="animate-pulse text-[#0B1B3A]/50">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full bg-gradient-to-b from-white/40 to-blue-50/20 backdrop-blur-2xl border border-cyan-400/30 rounded-3xl overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.1),0_0_20px_rgba(0,229,255,0.15)] ring-1 ring-white/60">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/50 bg-white/30 flex items-center gap-3 shadow-sm relative z-10">
        <div className="p-2 bg-cyan-400/10 border border-cyan-400/20 rounded-xl shadow-inner">
          <Trophy className="w-5 h-5 text-[#0052FF]" strokeWidth={2.5} />
        </div>
        <h3 className="text-[#0B1B3A] font-black text-lg tracking-tight drop-shadow-[0_1px_0_rgba(255,255,255,0.5)]">
          Leaderboard
        </h3>
      </div>

      {/* List or empty state - scrollable container, shows 10 entries without scrolling */}
      <div className="overflow-y-auto p-3 space-y-2 max-h-[680px] leaderboard-scroll">
        {error ? (
          <div className="flex flex-col items-center justify-center text-center py-8">
            <p className="text-red-500 text-sm">{error}</p>
            <button 
              onClick={fetchLeaderboard}
              className="mt-2 text-[#0052FF] text-sm hover:underline"
            >
              Try again
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-8">
            <Users className="w-12 h-12 text-[#0B1B3A]/30 mb-3" />
            <p className="text-[#0B1B3A]/50 text-sm">No players yet</p>
            <p className="text-[#0B1B3A]/30 text-xs mt-1">Be the first!</p>
          </div>
        ) : (
          entries.map((item) => {
            const isTop3 = item.rank <= 3;
            return (
              <div
                key={item.rank}
                className={`flex items-center justify-between p-3 rounded-2xl transition-all duration-200 group border shadow-sm ${
                  isTop3
                    ? 'bg-gradient-to-r from-white/60 to-white/40 border-white/60 shadow-blue-900/5'
                    : 'bg-white/40 border-white/40 hover:bg-white/60 hover:border-white/60 hover:shadow-md hover:shadow-cyan-400/10'
                }`}
              >
                <div className="flex items-center gap-3">
                  {getRankBadge(item.rank)}
                  <span
                    className={`text-[15px] font-bold tracking-wide drop-shadow-[0_1px_0_rgba(255,255,255,0.4)] text-[#0B1B3A]`}
                  >
                    {item.wallet.length > 13 
                      ? `${item.wallet.slice(0, 6)}...${item.wallet.slice(-4)}`
                      : item.wallet
                    }
                  </span>
                </div>

                <span
                  className={`text-[15px] font-black text-right drop-shadow-[0_1px_0_rgba(255,255,255,0.4)] ${
                    isTop3 ? 'text-[#0052FF]' : 'text-[#000000]'
                  }`}
                >
                  {formatPoints(item.points)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default React.memo(Leaderboard);
