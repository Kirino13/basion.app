import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getBaseAppBonusPercent, getEffectiveBoostPercent } from '@/lib/baseApp';
import { applyTapTxToDb } from '@/lib/tapSync';

/**
 * POST /api/sync-user
 *
 * Called from the frontend after each tap to credit points with boost.
 *
 * Body: {
 *   mainWallet: string   - User's main wallet address
 *   txHash: string       - Transaction hash for verification
 *   tapCount?: number    - Ignored (derived from on-chain calldata)
 * }
 *
 * Idempotent: calling twice with the same txHash returns the same result.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { mainWallet, txHash } = body;

    if (!mainWallet) {
      return NextResponse.json({ error: 'Missing mainWallet' }, { status: 400 });
    }
    if (!txHash) {
      return NextResponse.json({ error: 'Missing txHash' }, { status: 401 });
    }

    // Validate wallet format
    if (!/^0x[a-fA-F0-9]{40}$/.test(mainWallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ success: true, message: 'Database not configured' });
    }

    const normalizedWallet = mainWallet.toLowerCase();

    // Get user's current boost from DB
    const { data: userData } = await supabase
      .from('users')
      .select('boost_percent')
      .eq('main_wallet', normalizedWallet)
      .single();

    const baseBoostPercent = Number(userData?.boost_percent) || 0;
    const baseAppBonusPercent = getBaseAppBonusPercent(request.headers);
    const effectiveBoostPercent = getEffectiveBoostPercent(baseBoostPercent, request.headers);

    // --- Core: verify tx + idempotent insert + atomic increment ---
    const result = await applyTapTxToDb({
      txHash,
      mainWallet,
      effectiveBoostPercent,
      source: 'ui',
      supabase,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      cached: result.alreadyProcessed,
      pointsEarned: result.pointsEarned,
      boostPercent: effectiveBoostPercent,
      baseBoostPercent,
      baseAppBonusPercent,
      effectiveBoostPercent,
      points: {
        total: result.totalPoints,
        premium: result.premiumPoints,
        standard: result.standardPoints,
      },
      tapBalance: result.tapBalance,
    });
  } catch (error) {
    console.error('Sync user error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
