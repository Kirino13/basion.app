import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { mainWallet, points, totalTaps, tapBalance } = body;
    
    console.log('=== SYNC USER API ===');
    console.log('Received data:', body);

    // Validate inputs
    if (!mainWallet) {
      console.log('Error: Missing mainWallet');
      return NextResponse.json({ error: 'Missing mainWallet' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // If Supabase is not configured, just return success
    if (!supabase) {
      console.log('Warning: Supabase not configured');
      return NextResponse.json({ success: true, message: 'Database not configured' });
    }

    const upsertData = {
      main_wallet: mainWallet.toLowerCase(),
      points: points || 0,
      total_taps: totalTaps || 0,
      taps_remaining: tapBalance || 0,
      last_tap_at: new Date().toISOString(),
    };
    
    console.log('Upserting data:', upsertData);

    // Update user record with points and stats
    const { data, error } = await supabase.from('users').upsert(
      upsertData,
      {
        onConflict: 'main_wallet',
      }
    ).select();

    if (error) {
      console.error('Supabase upsert error:', error);
      throw error;
    }

    console.log('Upsert successful, result:', data);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Sync user error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
