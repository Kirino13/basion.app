import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Rate limiting: prevent spam burner registration
const registerRateLimitMap = new Map<string, number>();
const REGISTER_RATE_WINDOW = 30000; // 30 seconds between registrations per wallet

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

    // Rate limiting
    const key = mainWallet.toLowerCase();
    const lastRequest = registerRateLimitMap.get(key);
    if (lastRequest && Date.now() - lastRequest < REGISTER_RATE_WINDOW) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }
    registerRateLimitMap.set(key, Date.now());

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

    // Update user record
    const { error: userError } = await supabase.from('users').upsert(
      {
        main_wallet: mainWallet.toLowerCase(),
        burner_wallet: burnerWallet.toLowerCase(),
      },
      {
        onConflict: 'main_wallet',
      }
    );

    if (userError) {
      console.error('Error updating user:', userError);
      throw userError;
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
