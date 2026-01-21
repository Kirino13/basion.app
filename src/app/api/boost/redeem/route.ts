import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Boost codes from environment (server-side only, NOT NEXT_PUBLIC_)
// Format: CODE1:AMOUNT,CODE2:AMOUNT (e.g., "BONUS20:20,VIP50:50")
const BOOST_CODES_RAW = process.env.BOOST_CODES || 'MAVRINO40413:20';
const BOOST_CODES = new Map<string, number>(
  BOOST_CODES_RAW.split(',').map(entry => {
    const [code, amount] = entry.split(':');
    return [code.trim().toUpperCase(), parseInt(amount) || 20];
  })
);

// Rate limiting: max 10 code attempts per minute per address
const codeRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const CODE_RATE_LIMIT = 10;
const CODE_RATE_WINDOW = 60000;

function checkCodeRateLimit(address: string): boolean {
  const now = Date.now();
  const key = address.toLowerCase();
  const record = codeRateLimitMap.get(key);
  
  if (!record || now > record.resetAt) {
    codeRateLimitMap.set(key, { count: 1, resetAt: now + CODE_RATE_WINDOW });
    return true;
  }
  
  if (record.count >= CODE_RATE_LIMIT) {
    return false;
  }
  
  record.count++;
  return true;
}

// POST /api/boost/redeem
// Body: { address: string, code: string }
// Applies boost if code is valid (max 100%)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { address, code } = body;

    if (!address || !code) {
      return NextResponse.json({ ok: false, error: 'MISSING_PARAMS' }, { status: 400 });
    }

    const normalizedAddress = address.toLowerCase();
    const normalizedCode = code.trim().toUpperCase();

    // Rate limiting
    if (!checkCodeRateLimit(normalizedAddress)) {
      return NextResponse.json({ ok: false, error: 'RATE_LIMIT' }, { status: 429 });
    }

    // Validate code from environment-configured codes
    const boostAmount = BOOST_CODES.get(normalizedCode);
    if (!boostAmount) {
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

    // Calculate new boost (add boost amount, max 100%)
    const newBoost = Math.min(currentBoost + boostAmount, 100);
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
      addedBoost: boostAmount
    });
  } catch (error) {
    console.error('Boost redeem error:', error);
    return NextResponse.json(
      { ok: false, error: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
