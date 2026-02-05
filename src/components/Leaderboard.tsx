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
    let isMounted = true;
    const abortController = new AbortController();

    const fetchLeaderboard = async () => {
      try {
        setError(null);
        const res = await fetch('/api/leaderboard?limit=10', {
          signal: abortController.signal 
        });
        
        if (!res.ok) {
          throw new Error(`HTTP error: ${res.status}`);
        }
        
        const data = await res.json();
        if (isMounted) {
          setEntries(data);
        }
      } catch (err) {
        // Ignore abort errors
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Failed to fetch leaderboard:', err);
        if (isMounted) {
          setError('Failed to load leaderboard');
          setEntries([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 30000); // Update every 30 sec
    
    return () => {
      isMounted = false;
      abortController.abort();
      clearInterval(interval);
    };
  }, []);

  // Keep fetchLeaderboard for manual retry button
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
        <div className="w-6 h-6 lg:w-8 lg:h-8 rounded-full bg-gradient-to-b from-[#FFD700] to-[#FFA500] flex items-center justify-center text-white text-xs lg:text-sm font-bold shadow-sm">
          1
        </div>
      );
    }
    if (rank === 2) {
      return (
        <div className="w-6 h-6 lg:w-8 lg:h-8 rounded-full bg-gradient-to-b from-[#E8E8E8] to-[#B8B8B8] flex items-center justify-center text-white text-xs lg:text-sm font-bold shadow-sm">
          2
        </div>
      );
    }
    if (rank === 3) {
      return (
        <div className="w-6 h-6 lg:w-8 lg:h-8 rounded-full bg-gradient-to-b from-[#E8A060] to-[#CD7F32] flex items-center justify-center text-white text-xs lg:text-sm font-bold shadow-sm">
          3
        </div>
      );
    }
    return (
      <div className="w-6 h-6 lg:w-8 lg:h-8 rounded-full bg-slate-100 text-[#1a1a2e] text-xs lg:text-sm font-semibold flex items-center justify-center">
        {rank}
      </div>
    );
  };

  const formatPoints = (points: number) => {
    if (Number.isInteger(points)) return points.toLocaleString();
    return points.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  };

  // Calculate height for visible entries - responsive
  // Mobile: smaller entries (44px) with 6px gap
  // Desktop: 60px entries with 8px gap
  // Always show 10 entries visible, scrollable for rest

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col w-full bg-[#4da6ff]/30 backdrop-blur-sm rounded-2xl lg:rounded-3xl overflow-hidden border border-white/40">
        <div className="px-3 lg:px-5 py-2 lg:py-3 border-b border-white/30 flex items-center gap-2 lg:gap-3 shrink-0">
          <div className="p-1.5 lg:p-2 bg-white/30 rounded-lg lg:rounded-xl">
            <Trophy className="w-4 h-4 lg:w-5 lg:h-5 text-[#0052FF]" strokeWidth={2.5} />
          </div>
          <h3 className="text-[#0B1B3A] font-bold text-base lg:text-lg">Leaderboard</h3>
        </div>
        <div className="flex items-center justify-center py-6 lg:py-8">
          <div className="animate-pulse text-slate-500 text-sm lg:text-base">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full bg-[#4da6ff]/30 backdrop-blur-sm rounded-2xl lg:rounded-3xl overflow-hidden border border-white/40">
      {/* Header */}
      <div className="px-3 lg:px-5 py-2 lg:py-3 border-b border-white/30 flex items-center gap-2 lg:gap-3 shrink-0">
        <div className="p-1.5 lg:p-2 bg-white/30 rounded-lg lg:rounded-xl">
          <Trophy className="w-4 h-4 lg:w-5 lg:h-5 text-[#0052FF]" strokeWidth={2.5} />
        </div>
        <h3 className="text-[#0B1B3A] font-bold text-base lg:text-lg">
          Leaderboard
        </h3>
      </div>

      {/* List — scrollable, smaller on mobile */}
      <div 
        className="overflow-x-hidden px-2 lg:px-3 py-1 lg:py-2 leaderboard-scroll flex flex-col gap-1 lg:gap-2 max-h-[180px] lg:max-h-none overflow-y-auto lg:overflow-y-visible"
      >
        {error ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-6 lg:py-8">
            <p className="text-red-500 text-xs lg:text-sm">{error}</p>
            <button 
              onClick={fetchLeaderboard}
              className="mt-2 text-[#0052FF] text-xs lg:text-sm hover:underline"
            >
              Try again
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-6 lg:py-8">
            <Users className="w-10 h-10 lg:w-12 lg:h-12 text-slate-300 mb-2 lg:mb-3" />
            <p className="text-slate-500 text-xs lg:text-sm">No players yet</p>
            <p className="text-slate-400 text-[10px] lg:text-xs mt-1">Be the first!</p>
          </div>
        ) : (
          entries.slice(0, 10).map((item) => {
            const isTop3 = item.rank <= 3;
            return (
              <div
                key={item.rank}
                className="flex items-center justify-between px-2 lg:px-4 py-2 lg:py-[14px] rounded-xl lg:rounded-2xl bg-[#c8e8ff]/90 border border-white/60 shrink-0"
              >
                <div className="flex items-center gap-2 lg:gap-3">
                  {getRankBadge(item.rank)}
                  <span className="text-xs lg:text-[15px] font-semibold text-[#1a1a2e]">
                    {item.wallet.length > 13 
                      ? `${item.wallet.slice(0, 6)}...${item.wallet.slice(-4)}`
                      : item.wallet
                    }
                  </span>
                </div>

                <span
                  className={`text-xs lg:text-[15px] font-bold text-right ${
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
