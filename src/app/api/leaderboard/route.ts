import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Disable caching for real-time leaderboard
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');

    const supabase = getSupabaseAdmin();

    // If Supabase not configured - return empty array
    if (!supabase) {
      console.warn('Supabase not configured. Leaderboard will be empty.');
      return NextResponse.json([]);
    }

    const { data, error } = await supabase
      .from('users')
      .select('main_wallet, total_points, boost_percent')
      .gt('total_points', 0) // Only users with points
      .order('total_points', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }

    // Format response with ranks and apply boost to points
    const leaderboard = (data || [])
      .map((user) => {
        const basePoints = user.total_points || 0;
        const boostPercent = user.boost_percent || 0;
        // Apply boost: points * (1 + boost/100)
        const boostedPoints = basePoints * (1 + boostPercent / 100);
        return {
          wallet: user.main_wallet,
          points: boostedPoints,
          basePoints: basePoints,
          boostPercent: boostPercent,
        };
      })
      // Re-sort by boosted points (in case boost changes ranking)
      .sort((a, b) => b.points - a.points)
      // Add ranks after sorting
      .map((entry, index) => ({
        rank: index + 1,
        wallet: entry.wallet,
        points: entry.points,
      }));

    return NextResponse.json(leaderboard);
  } catch (error) {
    console.error('Leaderboard error:', error);
    // Return empty array on error
    return NextResponse.json([], { status: 200 });
  }
}
