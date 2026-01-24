'use client';

import React, { useState, useEffect } from 'react';
import { Trophy, Users } from 'lucide-react';
import { LeaderboardEntry } from '@/types';

interface LeaderboardProps {
  currentUserPoints?: number;
}

const Leaderboard: React.FC<LeaderboardProps> = () => {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 30000); // Update every 30 sec
    return () => clearInterval(interval);
  }, []);

  const fetchLeaderboard = async () => {
    try {
      setError(null);
      const res = await fetch('/api/leaderboard?limit=10');
      
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
  };

  const getRankBadge = (rank: number) => {
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
      <div className="w-9 h-9 rounded-full bg-white text-[#0B1B3A] text-sm font-bold flex items-center justify-center border border-slate-200 shadow-sm">
        {rank}
      </div>
    );
  };

  const formatPoints = (points: number) => {
    if (Number.isInteger(points)) return points.toLocaleString();
    return points.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col w-full h-full bg-white rounded-3xl overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.08)] border border-slate-200/80">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-3 bg-white">
          <div className="p-2 bg-blue-50 rounded-xl">
            <Trophy className="w-5 h-5 text-[#0052FF]" strokeWidth={2.5} />
          </div>
          <h3 className="text-[#0B1B3A] font-black text-lg tracking-tight">Leaderboard</h3>
        </div>
        <div className="flex-1 flex items-center justify-center bg-white">
          <div className="animate-pulse text-slate-400">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-white rounded-3xl overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.08)] border border-slate-200/80">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-3 bg-white shrink-0">
        <div className="p-2 bg-blue-50 rounded-xl">
          <Trophy className="w-5 h-5 text-[#0052FF]" strokeWidth={2.5} />
        </div>
        <h3 className="text-[#0B1B3A] font-black text-lg tracking-tight">
          Leaderboard
        </h3>
      </div>

      {/* List or empty state */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
        {error ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <p className="text-red-500 text-sm">{error}</p>
            <button 
              onClick={fetchLeaderboard}
              className="mt-2 text-[#0052FF] text-sm hover:underline"
            >
              Try again
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <Users className="w-12 h-12 text-slate-300 mb-3" />
            <p className="text-slate-500 text-sm">No players yet</p>
            <p className="text-slate-400 text-xs mt-1">Be the first!</p>
          </div>
        ) : (
          entries.map((item) => {
            const isTop3 = item.rank <= 3;
            return (
              <div
                key={item.rank}
                className={`flex items-center justify-between p-3 rounded-2xl transition-all duration-200 ${
                  isTop3
                    ? 'bg-gradient-to-r from-slate-50 to-white border border-slate-100 shadow-sm'
                    : 'bg-slate-50/80 border border-slate-100 hover:bg-slate-100/80'
                }`}
              >
                <div className="flex items-center gap-3">
                  {getRankBadge(item.rank)}
                  <span className="text-[15px] font-bold tracking-wide text-[#0B1B3A]">
                    {item.wallet.length > 13 
                      ? `${item.wallet.slice(0, 6)}...${item.wallet.slice(-4)}`
                      : item.wallet
                    }
                  </span>
                </div>

                <span
                  className={`text-[15px] font-black text-right ${
                    isTop3 ? 'text-[#0052FF]' : 'text-[#0B1B3A]'
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
