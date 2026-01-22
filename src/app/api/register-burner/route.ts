import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { registerBurnerLimiter, checkRateLimit } from '@/lib/rateLimit';

export async function POST(request: Request) {
  try {
    const { mainWallet, burnerWallet, encryptedKey } = await request.json();

    // Validate inputs
    if (!mainWallet || !burnerWallet || !encryptedKey) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Validate wallet address formats
    if (!/^0x[a-fA-F0-9]{40}$/.test(mainWallet) || !/^0x[a-fA-F0-9]{40}$/.test(burnerWallet)) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
    }

    // Rate limiting via Upstash Redis (2 requests/30s per wallet)
    const rateLimitResult = await checkRateLimit(registerBurnerLimiter, mainWallet.toLowerCase());
    if (!rateLimitResult.success) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const supabase = getSupabaseAdmin();

    // If Supabase is not configured, just return success (for development)
    if (!supabase) {
      console.log('Supabase not configured, skipping database storage');
      return NextResponse.json({ success: true, message: 'Database not configured' });
    }

    // Store burner key - UPSERT on main_wallet to ensure ONE burner per wallet
    // If user already has a burner, this will update it (handles race conditions)
    const { error: keyError } = await supabase.from('burner_keys').upsert(
      {
        main_wallet: mainWallet.toLowerCase(),
        burner_wallet: burnerWallet.toLowerCase(),
        encrypted_key: encryptedKey,
      },
      {
        onConflict: 'main_wallet',
      }
    );

    if (keyError) {
      console.error('Error storing burner key:', keyError);
      throw keyError;
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('main_wallet')
      .eq('main_wallet', mainWallet.toLowerCase())
      .single();

    if (existingUser) {
      // User exists - only update burner_wallet, don't touch points
      const { error: userError } = await supabase
        .from('users')
        .update({ burner_wallet: burnerWallet.toLowerCase() })
        .eq('main_wallet', mainWallet.toLowerCase());

      if (userError) {
        console.error('Error updating user:', userError);
        throw userError;
      }
    } else {
      // New user - create with initial values so they appear in leaderboard immediately
      const { error: userError } = await supabase.from('users').insert({
        main_wallet: mainWallet.toLowerCase(),
        burner_wallet: burnerWallet.toLowerCase(),
        total_points: 0,
        premium_points: 0,
        standard_points: 0,
        boost_percent: 0,
      });

      if (userError) {
        console.error('Error creating user:', userError);
        throw userError;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Register burner error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
