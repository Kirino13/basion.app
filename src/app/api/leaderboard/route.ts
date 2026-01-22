import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { leaderboardLimiter, checkRateLimit } from '@/lib/rateLimit';

// Disable caching for real-time leaderboard
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Max limit to prevent abuse
const MAX_LEADERBOARD_LIMIT = 100;

export async function GET(request: Request) {
  try {
    // Rate limiting via Upstash Redis (60 requests/min per IP)
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const rateLimitResult = await checkRateLimit(leaderboardLimiter, ip);
    if (!rateLimitResult.success) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    // Enforce maximum limit to prevent abuse
    const requestedLimit = parseInt(searchParams.get('limit') || '100');
    const limit = Math.min(Math.max(1, requestedLimit), MAX_LEADERBOARD_LIMIT);

    const supabase = getSupabaseAdmin();

    // If Supabase not configured - return empty array
    if (!supabase) {
      console.warn('Supabase not configured. Leaderboard will be empty.');
      return NextResponse.json([]);
    }

    const { data, error } = await supabase
      .from('users')
      .select('main_wallet, total_points, boost_percent')
      .not('total_points', 'is', null) // Exclude NULL, include 0 and above
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
