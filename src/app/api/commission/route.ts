import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { commissionLimiter, checkRateLimit } from '@/lib/rateLimit';

// 10 commission wallets (excluded from paying commission themselves)
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

// Commission rate: 10% of points earned per tap
const COMMISSION_PERCENT = 0.1; // 10%

// POST /api/commission
// Body: { fromWallet: string }
// Adds 0.1 points to a random commission wallet
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { fromWallet } = body;

    if (!fromWallet) {
      return NextResponse.json({ error: 'Missing fromWallet' }, { status: 400 });
    }

    const normalizedWallet = fromWallet.toLowerCase();

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(normalizedWallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    // Skip if tapper is one of the commission wallets (they don't pay commission)
    if (COMMISSION_WALLETS.includes(normalizedWallet)) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'commission_wallet' });
    }

    // Rate limiting via Upstash Redis (60 requests/min per wallet)
    const rateLimitResult = await checkRateLimit(commissionLimiter, normalizedWallet);
    if (!rateLimitResult.success) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'no_database' });
    }

    // Commission is always 10% of base tap (0.1 point)
    // We store RAW commission (without boost), boost is applied only on display
    // This keeps consistency with premium_points and standard_points
    const commissionAmount = 1 * COMMISSION_PERCENT; // Always 0.1

    // Select random commission wallet
    const randomIndex = Math.floor(Math.random() * COMMISSION_WALLETS.length);
    const targetWallet = COMMISSION_WALLETS[randomIndex];

    // Get current commission points of target wallet
    const { data: targetUser, error: fetchError } = await supabase
      .from('users')
      .select('commission_points, total_points')
      .eq('main_wallet', targetWallet)
      .single();

    if (fetchError) {
      // Commission wallet doesn't exist - create it with initial commission
      const { error: insertError } = await supabase
        .from('users')
        .insert({
          main_wallet: targetWallet,
          commission_points: commissionAmount,
          premium_points: 0,
          standard_points: 0,
          boost_percent: 0,
        });

      if (insertError) {
        return NextResponse.json({ ok: false, error: 'Failed to create commission wallet' }, { status: 500 });
      }

      return NextResponse.json({ 
        ok: true, 
        targetWallet,
        commission: commissionAmount,
        created: true
      });
    }

    // Add commission to the target wallet's commission_points field
    const currentCommission = Number(targetUser.commission_points) || 0;
    const newCommission = currentCommission + commissionAmount;

    const { data: updateData, error: updateError } = await supabase
      .from('users')
      .update({ commission_points: newCommission })
      .eq('main_wallet', targetWallet)
      .select('total_points, commission_points');

    if (updateError) {
      return NextResponse.json({ ok: false, error: 'Failed to update commission' }, { status: 500 });
    }

    if (!updateData || updateData.length === 0) {
      return NextResponse.json({ ok: false, error: 'Update returned no rows' }, { status: 500 });
    }

    return NextResponse.json({ 
      ok: true, 
      targetWallet,
      commission: commissionAmount
    });
  } catch (error) {
    console.error('Commission error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
