import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Only one valid boost code
const VALID_CODE = 'MAVRINO40413';
const BOOST_AMOUNT = 20;

// POST /api/boost/redeem
// Body: { address: string, code: string }
// Applies a +20% boost if code is valid (max 100%)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { address, code } = body;

    if (!address || !code) {
      return NextResponse.json({ ok: false, error: 'MISSING_PARAMS' }, { status: 400 });
    }

    const normalizedAddress = address.toLowerCase();
    const normalizedCode = code.trim().toUpperCase();

    // Validate code - only MAVRINO40413 is valid
    if (normalizedCode !== VALID_CODE) {
      return NextResponse.json({ ok: false, error: 'INVALID_CODE' });
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ ok: false, error: 'DATABASE_NOT_CONFIGURED' }, { status: 500 });
    }

    // Get current user data
    const { data: userData, error: fetchError } = await supabase
      .from('users')
      .select('boost_percent, used_codes')
      .eq('main_wallet', normalizedAddress)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('Fetch user error:', fetchError);
    }

    const currentBoost = userData?.boost_percent || 0;
    const usedCodes: string[] = userData?.used_codes || [];

    // Check if code already used by this user (from database)
    if (usedCodes.includes(normalizedCode)) {
      return NextResponse.json({ ok: false, error: 'CODE_ALREADY_USED' });
    }

    // Calculate new boost (add 20%, max 100%)
    const newBoost = Math.min(currentBoost + BOOST_AMOUNT, 100);
    const newUsedCodes = [...usedCodes, normalizedCode];

    // Update user boost and used codes in database
    const { error: updateError } = await supabase
      .from('users')
      .upsert({
        main_wallet: normalizedAddress,
        boost_percent: newBoost,
        used_codes: newUsedCodes,
      }, { onConflict: 'main_wallet' });

    if (updateError) {
      console.error('Boost update error:', updateError);
      return NextResponse.json({ ok: false, error: 'UPDATE_FAILED' }, { status: 500 });
    }

    return NextResponse.json({ 
      ok: true, 
      boostPercent: newBoost,
      addedBoost: BOOST_AMOUNT
    });
  } catch (error) {
    console.error('Boost redeem error:', error);
    return NextResponse.json(
      { ok: false, error: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
