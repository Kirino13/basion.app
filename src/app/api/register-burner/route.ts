import { NextResponse } from 'next/server';
import { verifyMessage } from 'viem';
import { getSupabaseAdmin } from '@/lib/supabase';
import { encryptKey } from '@/lib/encryption';

export async function POST(request: Request) {
  try {
    const { mainWallet, burnerWallet, privateKey, signature, timestamp } = await request.json();

    // Validate inputs
    if (!mainWallet || !burnerWallet || !privateKey) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Validate wallet format
    if (!/^0x[a-fA-F0-9]{40}$/.test(mainWallet) || !/^0x[a-fA-F0-9]{40}$/.test(burnerWallet)) {
      return NextResponse.json({ error: 'Invalid wallet format' }, { status: 400 });
    }

    // Validate private key format
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
      return NextResponse.json({ error: 'Invalid private key format' }, { status: 400 });
    }

    // SECURITY: Require signature to prove ownership of mainWallet
    if (!signature || !timestamp) {
      return NextResponse.json({ error: 'Signature required' }, { status: 401 });
    }

    // Verify timestamp (5 minute window)
    const ts = parseInt(timestamp);
    if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Signature expired' }, { status: 401 });
    }

    // Verify signature
    const message = `Register burner ${burnerWallet} for ${mainWallet} at ${timestamp}`;
    let isValid = false;
    try {
      isValid = await verifyMessage({
        address: mainWallet as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
    } catch {
      return NextResponse.json({ error: 'Invalid signature format' }, { status: 401 });
    }

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();

    // If Supabase is not configured, just return success (for development)
    if (!supabase) {
      console.log('Supabase not configured, skipping database storage');
      return NextResponse.json({ success: true, message: 'Database not configured' });
    }

    // Encrypt the private key on server side
    const encryptedKey = encryptKey(privateKey);

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
