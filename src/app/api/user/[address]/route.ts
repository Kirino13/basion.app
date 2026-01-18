import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    const { address } = await params;
    const normalizedAddress = address.toLowerCase();

    const supabase = getSupabaseAdmin();

    // If Supabase is not configured, return default user data
    if (!supabase) {
      return NextResponse.json({
        mainWallet: normalizedAddress,
        tapsRemaining: 0,
        points: 0,
        totalTaps: 0,
        referralActive: false,
      });
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('main_wallet', normalizedAddress)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    if (!data) {
      return NextResponse.json({
        mainWallet: normalizedAddress,
        tapsRemaining: 0,
        points: 0,
        totalTaps: 0,
        referralActive: false,
      });
    }

    return NextResponse.json({
      mainWallet: data.main_wallet,
      burnerWallet: data.burner_wallet,
      tapsRemaining: data.taps_remaining || 0,
      points: data.points || 0,
      totalTaps: data.total_taps || 0,
      referrer: data.referrer,
      referralActive: data.referral_active || false,
      referralBonus: data.referral_bonus || 0,
      referralCount: data.referral_count || 0,
    });
  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
