import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { syncUserLimiter, checkRateLimit } from '@/lib/rateLimit';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    // premiumPoints and standardPoints are RAW points from contract
    // boost_percent from DB is applied to NEW points earned since last sync
    const { mainWallet, premiumPoints, standardPoints, tapBalance } = body;

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
      .select('total_taps, premium_points, standard_points, taps_remaining, boost_percent')
      .eq('main_wallet', mainWallet.toLowerCase())
      .single();

    // Build update object
    const updateData: Record<string, unknown> = {
      main_wallet: mainWallet.toLowerCase(),
      last_tap_at: new Date().toISOString(),
    };

    // Get user's boost multiplier from DB (from promo codes/referrals)
    const boostPercent = existingUser?.boost_percent || 0;
    const boostMultiplier = 1 + boostPercent / 100;

    // Calculate boosted premium points
    if (typeof premiumPoints === 'number' && premiumPoints >= 0) {
      // total_taps stores RAW value from contract (for delta calculation)
      const oldTotalTaps = existingUser?.total_taps || 0;
      const newPoints = Math.max(0, premiumPoints - oldTotalTaps);
      
      if (newPoints > 0) {
        // Apply DB boost to newly earned points only
        const boostedNewPoints = newPoints * boostMultiplier;
        const currentPremiumPoints = existingUser?.premium_points || 0;
        updateData.premium_points = currentPremiumPoints + boostedNewPoints;
      } else if (!existingUser) {
        // First sync - apply boost to all
        updateData.premium_points = premiumPoints * boostMultiplier;
      }
      
      // Always update total_taps to track raw contract value
      updateData.total_taps = premiumPoints;
    }

    // Standard points - no boost applied
    if (typeof standardPoints === 'number' && standardPoints >= 0) {
      updateData.standard_points = standardPoints;
    }
    
    // Tap balance
    if (typeof tapBalance === 'number' && tapBalance >= 0) {
      updateData.taps_remaining = tapBalance;
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
