import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// 10 commission wallets
const COMMISSION_WALLETS = [
  '0x7cf0E9B33800E21fD69Aa3Fe693B735A121AA950',
  '0x338388413cb284B31122B84da5E330017A8692C0',
  '0x5f878c7D5F4B25F5730A703a65d1492bc2b16cfB',
  '0x953e94EEf0740b77E230EEd5849432E2C9e4b2B2',
  '0x174f44A473Bb7aDfe005157abc8EAc27Bf3575f3',
  '0x8dD04af9be247A87438da2812C555C3c0F4df8d7',
  '0x882ABb7ab668188De2F80A02c958C3f88f5B0db4',
  '0xceF725dB47160438787b6ED362162DafCA6677cd',
  '0x8d1eE41E1AC330C96E36f272Cc1bE3572fB30c97',
  '0xbc189B1BC53adC93c6019DD03feccf4311D0175a',
].map(w => w.toLowerCase());

// Commission rate: 10% of points per tap
const COMMISSION_PERCENT = 0.1;

// Internal token for verification - MUST be set in env
const COMMISSION_TOKEN = process.env.COMMISSION_INTERNAL_TOKEN || process.env.NEXT_PUBLIC_COMMISSION_TOKEN;

/**
 * POST /api/commission
 * Adds 0.1 points to a random commission wallet per tap
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { fromWallet, _token } = body;

    if (!fromWallet) {
      return NextResponse.json({ error: 'Missing fromWallet' }, { status: 400 });
    }

    // Verify internal token
    if (!COMMISSION_TOKEN || _token !== COMMISSION_TOKEN) {
      return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 401 });
    }

    const normalizedWallet = fromWallet.toLowerCase();

    // Validate wallet format
    if (!/^0x[a-fA-F0-9]{40}$/.test(normalizedWallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    // Skip if tapper is a commission wallet
    if (COMMISSION_WALLETS.includes(normalizedWallet)) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const commissionAmount = COMMISSION_PERCENT; // 0.1 per tap
    const randomIndex = Math.floor(Math.random() * COMMISSION_WALLETS.length);
    const targetWallet = COMMISSION_WALLETS[randomIndex];

    // Get current commission
    const { data: targetUser } = await supabase
      .from('users')
      .select('commission_points')
      .eq('main_wallet', targetWallet)
      .single();

    if (targetUser) {
      const currentCommission = Number(targetUser.commission_points) || 0;
      await supabase
        .from('users')
        .update({ commission_points: currentCommission + commissionAmount })
        .eq('main_wallet', targetWallet);
    } else {
      await supabase.from('users').insert({
        main_wallet: targetWallet,
        commission_points: commissionAmount,
        premium_points: 0,
        standard_points: 0,
      });
    }

    return NextResponse.json({ ok: true, targetWallet, commission: commissionAmount });
  } catch (error) {
    console.error('Commission error:', error);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}
