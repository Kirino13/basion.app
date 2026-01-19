import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;
    const normalizedAddress = address.toLowerCase();

    const supabase = getSupabaseAdmin();

    // Default response for new users
    const defaultResponse = {
      mainWallet: normalizedAddress,
      tapsRemaining: 0,
      premiumPoints: 0,
      standardPoints: 0,
      totalPoints: 0,
      pointsMultiplier: 100,
      isBlacklisted: false,
      airdropClaimed: false,
    };

    // If Supabase is not configured, return default user data
    if (!supabase) {
      return NextResponse.json(defaultResponse);
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('main_wallet', normalizedAddress)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    if (!data) {
      return NextResponse.json(defaultResponse);
    }

    return NextResponse.json({
      mainWallet: data.main_wallet,
      burnerWallet: data.burner_wallet,
      tapsRemaining: data.taps_remaining || 0,
      premiumPoints: data.premium_points || 0,
      standardPoints: data.standard_points || 0,
      totalPoints: data.total_points || 0,
      pointsMultiplier: data.points_multiplier || 100,
      referrer: data.referrer_address,
      isBlacklisted: data.is_blacklisted || false,
      airdropClaimed: data.airdrop_claimed || false,
    });
  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
