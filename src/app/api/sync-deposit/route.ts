import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// POST /api/sync-deposit
// Body: { wallet: string, usdAmount: number }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { wallet, usdAmount } = body;

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
