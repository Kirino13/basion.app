import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Internal token for sync endpoints - must be set in env
const SYNC_TOKEN = process.env.SYNC_INTERNAL_TOKEN || process.env.NEXT_PUBLIC_SYNC_TOKEN;

// POST /api/sync-deposit
// Body: { wallet: string, usdAmount: number, _token: string }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { wallet, usdAmount, _token } = body;

    // SECURITY: Require internal token
    if (!SYNC_TOKEN || _token !== SYNC_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!wallet || typeof usdAmount !== 'number') {
      return NextResponse.json({ error: 'Missing wallet or usdAmount' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ success: true, message: 'Database not configured' });
    }

    const normalizedWallet = wallet.toLowerCase();

    // Get current deposit total
    const { data: userData } = await supabase
      .from('users')
      .select('total_deposit_usd, deposit_count')
      .eq('main_wallet', normalizedWallet)
      .single();

    const currentTotal = userData?.total_deposit_usd || 0;
    const currentCount = userData?.deposit_count || 0;

    // Update with new deposit
    const { error } = await supabase
      .from('users')
      .upsert({
        main_wallet: normalizedWallet,
        total_deposit_usd: currentTotal + usdAmount,
        deposit_count: currentCount + 1,
        last_deposit_at: new Date().toISOString(),
      }, { onConflict: 'main_wallet' });

    if (error) {
      console.error('Error tracking deposit:', error);
      return NextResponse.json({ error: 'Failed to track deposit' }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      totalDepositUsd: currentTotal + usdAmount,
      depositCount: currentCount + 1
    });
  } catch (error) {
    console.error('Sync deposit error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
