import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { syncUserLimiter, checkRateLimit } from '@/lib/rateLimit';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    // premiumTaps and standardTaps are TAP COUNTS from contract
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

    // Get existing user data INCLUDING boost_percent
    const { data: existingUser } = await supabase
      .from('users')
      .select('total_taps, premium_points, standard_points, taps_remaining, boost_percent')
      .eq('main_wallet', mainWallet.toLowerCase())
      .single();

    // Get user's boost multiplier (boost is applied at earning time)
    const boostPercent = existingUser?.boost_percent || 0;
    const boostMultiplier = 1 + boostPercent / 100; // e.g., 1.2 for 20% boost

    // Build update object
    const updateData: Record<string, unknown> = {
      main_wallet: mainWallet.toLowerCase(),
      last_tap_at: new Date().toISOString(),
    };

    // Store BOOSTED points (boost applied at earning time)
    // This way DB stores actual points, and we show them as-is everywhere
    
    // Calculate new PREMIUM points WITH boost
    if (typeof premiumTaps === 'number' && premiumTaps >= 0) {
      const oldTotalTaps = existingUser?.total_taps || 0;
      const newTaps = Math.max(0, premiumTaps - oldTotalTaps);
      
      if (newTaps > 0) {
        // Apply boost at earning time: new_taps × boost_multiplier
        const earnedPoints = newTaps * boostMultiplier;
        const currentPremiumPoints = existingUser?.premium_points || 0;
        updateData.premium_points = currentPremiumPoints + earnedPoints;
      }
      
      // Always update total_taps to sync with contract (raw tap count)
      updateData.total_taps = premiumTaps;
    }

    // Calculate new STANDARD points WITH boost (same incremental logic)
    // Note: standard_points tracking would need a separate counter like total_standard_taps
    // For now, standard points are less common, keeping simple logic
    if (typeof standardTaps === 'number' && standardTaps >= 0) {
      // Standard points from contract - store as-is (no boost for standard)
      // Boost only applies to premium taps which user actively earns
      updateData.standard_points = standardTaps;
    }
    
    // Tap balance can decrease (when tapping)
    if (typeof tapBalance === 'number' && tapBalance >= 0) {
      const currentTaps = existingUser?.taps_remaining || 0;
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
