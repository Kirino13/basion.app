import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

/**
 * GET /api/get-burner?wallet=0x...
 *
 * Returns whether a burner wallet exists on server for given main wallet.
 * Never returns private keys.
 *
 * Response:
 * 200 { exists: boolean, burnerAddress: string | null }
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet');

    if (!wallet) {
      return NextResponse.json(
        { exists: false, burnerAddress: null, error: 'Missing wallet parameter' },
        { status: 400 }
      );
    }

    const normalizedWallet = wallet.toLowerCase();
    if (!/^0x[a-fA-F0-9]{40}$/.test(normalizedWallet)) {
      return NextResponse.json(
        { exists: false, burnerAddress: null, error: 'Invalid wallet address' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { exists: false, burnerAddress: null, error: 'Database not configured' },
        { status: 500 }
      );
    }

    const { data, error } = await supabase
      .from('burner_keys')
      .select('burner_wallet')
      .eq('main_wallet', normalizedWallet)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      // No burner found - expected for new users
      // Return 200 to avoid false negatives in client logic
      // (so UI can decide whether to show restore or deposit flow)
      if ((error as { code?: string } | null)?.code === 'PGRST116') {
        return NextResponse.json({ exists: false, burnerAddress: null });
      }
      throw error;
    }

    return NextResponse.json({
      exists: true,
      burnerAddress: data.burner_wallet,
    });
  } catch (error) {
    console.error('Get burner error:', error);
    return NextResponse.json(
      { exists: false, burnerAddress: null, error: 'Failed to get burner' },
      { status: 500 }
    );
  }
}
