import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Valid boost codes from environment variable
// Format: comma-separated, e.g. "CODE1,CODE2,BOOST20"
const VALID_CODES = (process.env.BOOST_CODES || 'BASION20,BOOST2024').split(',').map(c => c.trim().toUpperCase());

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

    // Normalize code
    const normalizedCode = code.trim().toUpperCase();

    // Validate code
    if (!VALID_CODES.includes(normalizedCode)) {
      return NextResponse.json({ ok: false, error: 'INVALID_CODE' });
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ ok: false, error: 'DATABASE_NOT_CONFIGURED' }, { status: 500 });
    }

    // Get current boost
    const { data: userData } = await supabase
      .from('users')
      .select('boost_percent, used_codes')
      .eq('main_wallet', address.toLowerCase())
      .single();

    const currentBoost = userData?.boost_percent || 0;
    const usedCodes: string[] = userData?.used_codes || [];

    // Check if code already used by this user
    if (usedCodes.includes(normalizedCode)) {
      return NextResponse.json({ ok: false, error: 'CODE_ALREADY_USED' });
    }

    // Calculate new boost (add 20%, max 100%)
    const newBoost = Math.min(currentBoost + 20, 100);
    const newUsedCodes = [...usedCodes, normalizedCode];

    // Update user boost
    const { error: updateError } = await supabase
      .from('users')
      .upsert({
        main_wallet: address.toLowerCase(),
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
      addedBoost: 20
    });
  } catch (error) {
    console.error('Boost redeem error:', error);
    return NextResponse.json(
      { ok: false, error: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
