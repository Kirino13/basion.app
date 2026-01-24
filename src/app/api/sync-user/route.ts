import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Internal token for sync endpoints - must be set in env
const SYNC_TOKEN = process.env.SYNC_INTERNAL_TOKEN || process.env.NEXT_PUBLIC_SYNC_TOKEN;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { mainWallet, points, premiumPoints, standardPoints, tapBalance, _token } = body;

    // SECURITY: Require internal token
    if (!SYNC_TOKEN || _token !== SYNC_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!mainWallet) {
      return NextResponse.json({ error: 'Missing mainWallet' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ success: true, message: 'Database not configured' });
    }

    // Build update object - only include fields with valid values
    const updateData: Record<string, unknown> = {
      main_wallet: mainWallet.toLowerCase(),
      last_tap_at: new Date().toISOString(),
    };
    
    // Update total points (premium + standard)
    if (typeof points === 'number' && points >= 0) {
      updateData.total_points = points;
    }
    
    // Update premium points (more valuable - 1 tap = 1 tx)
    if (typeof premiumPoints === 'number' && premiumPoints >= 0) {
      updateData.premium_points = premiumPoints;
    }
    
    // Update standard points (batch mode)
    if (typeof standardPoints === 'number' && standardPoints >= 0) {
      updateData.standard_points = standardPoints;
    }
    
    // Update tap balance
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
