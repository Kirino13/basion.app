import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { syncUserLimiter, checkRateLimit } from '@/lib/rateLimit';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    // premiumPoints and standardPoints are ALREADY CALCULATED POINTS from contract
    // Contract already applies multipliers, so we just store them directly
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

    // Build update object - directly sync from contract
    // Contract already handles all multipliers/boosts, so we just store the values
    const updateData: Record<string, unknown> = {
      main_wallet: mainWallet.toLowerCase(),
      last_tap_at: new Date().toISOString(),
    };

    // Premium points from contract (already includes contract-side multipliers)
    if (typeof premiumPoints === 'number' && premiumPoints >= 0) {
      updateData.premium_points = premiumPoints;
      updateData.total_taps = premiumPoints; // For tracking, same as premium for now
    }

    // Standard points from contract
    if (typeof standardPoints === 'number' && standardPoints >= 0) {
      updateData.standard_points = standardPoints;
    }
    
    // Tap balance (remaining taps)
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
