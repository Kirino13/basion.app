import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { syncUserLimiter, checkRateLimit } from '@/lib/rateLimit';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    // premiumTaps and standardTaps are TAP COUNTS from contract (not boosted)
    const { mainWallet, premiumPoints: premiumTaps, standardPoints: standardTaps, tapBalance } = body;

    if (!mainWallet) {
      return NextResponse.json({ error: 'Missing mainWallet' }, { status: 400 });
    }

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(mainWallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    // Rate limiting via Upstash Redis (30 requests/min per wallet)
    const rateLimitResult = await checkRateLimit(syncUserLimiter, mainWallet.toLowerCase());
    if (!rateLimitResult.success) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ success: true, message: 'Database not configured' });
    }

    // Get existing user data
    const { data: existingUser } = await supabase
      .from('users')
      .select('total_taps, premium_points, standard_points, taps_remaining')
      .eq('main_wallet', mainWallet.toLowerCase())
      .single();

    // Build update object
    const updateData: Record<string, unknown> = {
      main_wallet: mainWallet.toLowerCase(),
      last_tap_at: new Date().toISOString(),
    };

    // Store RAW points WITHOUT boost (boost is applied only on display)
    // This allows changing boost without recalculating all points in DB
    
    // Calculate new PREMIUM points (raw, no boost)
    if (typeof premiumTaps === 'number' && premiumTaps >= 0) {
      const oldTotalTaps = existingUser?.total_taps || 0;
      const newTaps = Math.max(0, premiumTaps - oldTotalTaps);
      
      if (newTaps > 0) {
        // Store raw points (1 tap = 1 point, no boost multiplication)
        const currentPremiumPoints = existingUser?.premium_points || 0;
        updateData.premium_points = currentPremiumPoints + newTaps;
      }
      
      // Always update total_taps to sync with contract
      updateData.total_taps = premiumTaps;
    }

    // Calculate new STANDARD points (raw, no boost)
    if (typeof standardTaps === 'number' && standardTaps >= 0) {
      const currentStandardPoints = existingUser?.standard_points || 0;
      
      // Store raw standard points (no boost)
      if (standardTaps > currentStandardPoints) {
        updateData.standard_points = standardTaps;
      }
    }
    
    // Tap balance can decrease (when tapping) - validate it's not increasing without deposit
    if (typeof tapBalance === 'number' && tapBalance >= 0) {
      const currentTaps = existingUser?.taps_remaining || 0;
      // Only allow decrease or same (taps used), not arbitrary increase
      if (tapBalance <= currentTaps || currentTaps === 0) {
        updateData.taps_remaining = tapBalance;
      }
    }

    // Note: total_points is calculated by DB trigger:
    // total_points = premium_points + standard_points + commission_points

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
