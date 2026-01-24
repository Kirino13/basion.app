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
      const res = await fetch('/api/leaderboard?limit=100');
      
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
        <div className="w-8 h-8 rounded-full bg-gradient-to-b from-[#FFD700] to-[#FFA500] flex items-center justify-center text-white text-sm font-bold shadow-sm">
          1
        </div>
      );
    }
    if (rank === 2) {
      return (
        <div className="w-8 h-8 rounded-full bg-gradient-to-b from-[#E8E8E8] to-[#B8B8B8] flex items-center justify-center text-white text-sm font-bold shadow-sm">
          2
        </div>
      );
    }
    if (rank === 3) {
      return (
        <div className="w-8 h-8 rounded-full bg-gradient-to-b from-[#E8A060] to-[#CD7F32] flex items-center justify-center text-white text-sm font-bold shadow-sm">
          3
        </div>
      );
    }
    return (
      <div className="w-8 h-8 rounded-full bg-slate-100 text-[#1a1a2e] text-sm font-semibold flex items-center justify-center">
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
      <div className="flex flex-col w-full h-full bg-[#4da6ff]/30 backdrop-blur-sm rounded-3xl overflow-hidden border border-white/40">
        <div className="px-5 py-3 border-b border-white/30 flex items-center gap-3 shrink-0">
          <div className="p-2 bg-white/30 rounded-xl">
            <Trophy className="w-5 h-5 text-[#0052FF]" strokeWidth={2.5} />
          </div>
          <h3 className="text-[#0B1B3A] font-bold text-lg">Leaderboard</h3>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-pulse text-slate-500">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-[#4da6ff]/30 backdrop-blur-sm rounded-3xl overflow-hidden border border-white/40">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/30 flex items-center gap-3 shrink-0">
        <div className="p-2 bg-white/30 rounded-xl">
          <Trophy className="w-5 h-5 text-[#0052FF]" strokeWidth={2.5} />
        </div>
        <h3 className="text-[#0B1B3A] font-bold text-lg">
          Leaderboard
        </h3>
      </div>

      {/* List — exactly 10 entries visible, dark blue scrollbar, up to 100 users */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 leaderboard-scroll" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
                className="flex items-center justify-between px-3 py-[10px] rounded-xl bg-white/80 border border-white/50 shrink-0"
              >
                <div className="flex items-center gap-3">
                  {getRankBadge(item.rank)}
                  <span className="text-[15px] font-semibold text-[#1a1a2e]">
                    {item.wallet.length > 13 
                      ? `${item.wallet.slice(0, 6)}...${item.wallet.slice(-4)}`
                      : item.wallet
                    }
                  </span>
                </div>

                <span
                  className={`text-[15px] font-bold text-right ${
                    isTop3 ? 'text-[#0066FF]' : 'text-[#1a1a2e]'
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
