import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Rate limiting
const refRegisterRateLimitMap = new Map<string, number>();
const REF_RATE_WINDOW = 5000; // 5 seconds between referral registrations

// POST /api/referral/register
// Called when user makes first deposit with a referrer
// Body: { userWallet: string, referrerWallet: string }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userWallet, referrerWallet } = body;

    if (!userWallet) {
      return NextResponse.json({ error: 'Missing userWallet' }, { status: 400 });
    }

    // Rate limiting
    const key = userWallet.toLowerCase();
    const lastRequest = refRegisterRateLimitMap.get(key);
    if (lastRequest && Date.now() - lastRequest < REF_RATE_WINDOW) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }
    refRegisterRateLimitMap.set(key, Date.now());

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userWallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ success: true, message: 'Database not configured' });
    }

    const normalizedUser = userWallet.toLowerCase();
    const normalizedReferrer = referrerWallet?.toLowerCase();

    // Check if user already has a referrer set
    const { data: existingUser } = await supabase
      .from('users')
      .select('referred_by')
      .eq('main_wallet', normalizedUser)
      .single();

    // If user already has a referrer, don't overwrite
    if (existingUser?.referred_by) {
      return NextResponse.json({ success: true, message: 'Referrer already set' });
    }

    // Validate referrer is not the same as user and is a valid address
    const isValidReferrer = normalizedReferrer && 
      normalizedReferrer !== normalizedUser &&
      normalizedReferrer !== '0x0000000000000000000000000000000000000000' &&
      normalizedReferrer.startsWith('0x') &&
      normalizedReferrer.length === 42;

    if (!isValidReferrer) {
      return NextResponse.json({ success: true, message: 'No valid referrer' });
    }

    // Save referrer for user (bonus will be applied on first tap)
    const { error } = await supabase
      .from('users')
      .upsert({
        main_wallet: normalizedUser,
        referred_by: normalizedReferrer,
        referral_bonus_claimed: false,
      }, { onConflict: 'main_wallet' });

    if (error) {
      console.error('Error saving referrer:', error);
      return NextResponse.json({ error: 'Failed to save referrer' }, { status: 500 });
    }

    return NextResponse.json({ success: true, referrer: normalizedReferrer });
  } catch (error) {
    console.error('Referral register error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
