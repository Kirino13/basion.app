import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Only one valid boost code
const VALID_CODE = 'MAVRINO40413';
const BOOST_AMOUNT = 20;

// In-memory storage for used codes (fallback if DB doesn't have the column)
const usedCodesMemory = new Map<string, string[]>();

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
      .select('boost_percent')
      .eq('main_wallet', normalizedAddress)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('Fetch user error:', fetchError);
    }

    const currentBoost = userData?.boost_percent || 0;

    // Check if code already used (in-memory check)
    const userUsedCodes = usedCodesMemory.get(normalizedAddress) || [];
    if (userUsedCodes.includes(normalizedCode)) {
      return NextResponse.json({ ok: false, error: 'CODE_ALREADY_USED' });
    }

    // If user already has boost >= 20, they might have used the code before
    if (currentBoost >= BOOST_AMOUNT) {
      return NextResponse.json({ ok: false, error: 'CODE_ALREADY_USED' });
    }

    // Calculate new boost (add 20%, max 100%)
    const newBoost = Math.min(currentBoost + BOOST_AMOUNT, 100);

    // Update user boost in database
    const { error: updateError } = await supabase
      .from('users')
      .upsert({
        main_wallet: normalizedAddress,
        boost_percent: newBoost,
      }, { onConflict: 'main_wallet' });

    if (updateError) {
      console.error('Boost update error:', updateError);
      return NextResponse.json({ ok: false, error: 'UPDATE_FAILED' }, { status: 500 });
    }

    // Mark code as used in memory
    usedCodesMemory.set(normalizedAddress, [...userUsedCodes, normalizedCode]);

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
