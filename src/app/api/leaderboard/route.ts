import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    // Max 100 users in leaderboard, no more
    const requestedLimit = parseInt(searchParams.get('limit') || '100');
    const limit = Math.min(requestedLimit, 100);

    const supabase = getSupabaseAdmin();

    // If Supabase not configured - return empty array
    if (!supabase) {
      console.warn('Supabase not configured. Leaderboard will be empty.');
      return NextResponse.json([]);
    }

    const { data, error } = await supabase
      .from('users')
      .select('main_wallet, total_points')
      .gt('total_points', 0) // Only users with points
      .order('total_points', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }

    // Format response with ranks
    const leaderboard = (data || []).map((user, index) => ({
      rank: index + 1,
      wallet: user.main_wallet,
      points: user.total_points || 0,
    }));

    return NextResponse.json(leaderboard);
  } catch (error) {
    console.error('Leaderboard error:', error);
    // Return empty array on error
    return NextResponse.json([], { status: 200 });
  }
}
