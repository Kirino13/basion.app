import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { mainWallet, points, totalTaps, tapBalance } = body;

    if (!mainWallet) {
      return NextResponse.json({ error: 'Missing mainWallet' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ success: true, message: 'Database not configured' });
    }

    const { error } = await supabase.from('users').upsert(
      {
        main_wallet: mainWallet.toLowerCase(),
        points: points || 0,
        total_taps: totalTaps || 0,
        taps_remaining: tapBalance || 0,
        last_tap_at: new Date().toISOString(),
      },
      { onConflict: 'main_wallet' }
    );

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Sync user error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
