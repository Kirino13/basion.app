import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet');

    if (!wallet) {
      return NextResponse.json({ error: 'Missing wallet parameter' }, { status: 400 });
    }

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Get burner for this wallet (most recent if multiple exist)
    const { data, error } = await supabase
      .from('burner_keys')
      .select('burner_wallet, encrypted_key')
      .eq('main_wallet', wallet.toLowerCase())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      // No burner found - this is expected for new users
      if (error.code === 'PGRST116') {
        return NextResponse.json({ exists: false });
      }
      throw error;
    }

    // Return encrypted key - only useful with ENCRYPTION_KEY
    // Security: Even if someone intercepts this, they can't decrypt without the key
    return NextResponse.json({
      exists: true,
      burnerAddress: data.burner_wallet,
      encryptedKey: data.encrypted_key,
    });
  } catch (error) {
    console.error('Get burner error:', error);
    return NextResponse.json(
      { error: 'Failed to get burner' },
      { status: 500 }
    );
  }
}
