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

    // Build update object - only include fields with valid values
    // This prevents overwriting with 0 if data is missing
    const updateData: Record<string, unknown> = {
      main_wallet: mainWallet.toLowerCase(),
      last_tap_at: new Date().toISOString(),
    };
    
    // Only update points if we have a valid number
    if (typeof points === 'number' && points >= 0) {
      updateData.points = points;
    }
    
    if (typeof totalTaps === 'number' && totalTaps >= 0) {
      updateData.total_taps = totalTaps;
    }
    
    if (typeof tapBalance === 'number' && tapBalance >= 0) {
      updateData.taps_remaining = tapBalance;
    }

    const { error } = await supabase.from('users').upsert(
      updateData,
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
