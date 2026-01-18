import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const { mainWallet, burnerWallet, encryptedKey } = await request.json();

    // Validate inputs
    if (!mainWallet || !burnerWallet || !encryptedKey) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // If Supabase is not configured, just return success (for development)
    if (!supabase) {
      console.log('Supabase not configured, skipping database storage');
      return NextResponse.json({ success: true, message: 'Database not configured' });
    }

    // Store burner key
    const { error: keyError } = await supabase.from('burner_keys').upsert(
      {
        main_wallet: mainWallet.toLowerCase(),
        burner_wallet: burnerWallet.toLowerCase(),
        encrypted_key: encryptedKey,
      },
      {
        onConflict: 'burner_wallet',
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
