import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// 10 commission wallets (excluded from paying commission themselves)
const COMMISSION_WALLETS = [
  '0xa7dd1012f28bfdbb4ad9efedb9df2c307d6b36ee',
  '0x57c7e1ace16ecd0ca9e69ae6f304379bb24daa44',
  '0x87a77e209890e3b94245c2e16ec26115bf0e8c76',
  '0x34f9b7723ca6ef99c1c0439b820185f14ea8835a',
  '0x444009b8b7b3a8db5fa398fe85850eb9647a83eb',
  '0x21aecbafb3554f8825646fd12d062d285c69cd23',
  '0x62214dfb42ba990ea4c2459d8d106715bfe9c371',
  '0x49c34ca9c70cc482a7f384b50cc1efd90b5ef2b1',
  '0x71da5fc867518fd4ef9a34c2537d8d9fa4bdecfa',
  '0xb72c6f4a2e2f5da09de215919f174c511ac998c5',
].map(w => w.toLowerCase());

// Commission rate: 10% of points earned per tap
const COMMISSION_PERCENT = 0.1; // 10%

// Rate limiting to prevent abuse
const commissionRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const COMMISSION_RATE_LIMIT = 60; // max 60 commission calls per minute
const COMMISSION_RATE_WINDOW = 60000;

function checkCommissionRateLimit(wallet: string): boolean {
  const now = Date.now();
  const key = wallet.toLowerCase();
  const record = commissionRateLimitMap.get(key);
  
  if (!record || now > record.resetAt) {
    commissionRateLimitMap.set(key, { count: 1, resetAt: now + COMMISSION_RATE_WINDOW });
    return true;
  }
  
  if (record.count >= COMMISSION_RATE_LIMIT) {
    return false;
  }
  
  record.count++;
  return true;
}

// Cleanup old rate limit entries
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of commissionRateLimitMap.entries()) {
    if (now > value.resetAt) {
      commissionRateLimitMap.delete(key);
    }
  }
}, 60000);

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

    // Rate limiting
    if (!checkCommissionRateLimit(normalizedWallet)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'no_database' });
    }

    // Get tapper's boost percentage to calculate actual points per tap
    const { data: tapperData } = await supabase
      .from('users')
      .select('boost_percent')
      .eq('main_wallet', normalizedWallet)
      .single();

    // Calculate points per tap with boost
    // Base: 1 point, with boost: 1 * (1 + boost_percent/100)
    const boostPercent = tapperData?.boost_percent || 0;
    const pointsPerTap = 1 * (1 + boostPercent / 100); // e.g., 1.2 with 20% boost, 1.5 with 50% boost
    
    // Commission is 10% of actual points earned
    const commissionAmount = pointsPerTap * COMMISSION_PERCENT; // e.g., 0.12 with 20% boost

    console.log('Commission calc:', { boostPercent, pointsPerTap, commissionAmount, COMMISSION_PERCENT });

    // Select random commission wallet
    const randomIndex = Math.floor(Math.random() * COMMISSION_WALLETS.length);
    const targetWallet = COMMISSION_WALLETS[randomIndex];

    // Get current points of target wallet
    const { data: targetUser, error: fetchError } = await supabase
      .from('users')
      .select('total_points')
      .eq('main_wallet', targetWallet)
      .single();

    let currentPoints = 0;

    if (fetchError) {
      // Commission wallet doesn't exist - create it with initial commission
      console.log('Creating commission wallet:', targetWallet, 'with', commissionAmount, 'points');
      const { data: insertData, error: insertError } = await supabase
        .from('users')
        .insert({
          main_wallet: targetWallet,
          total_points: commissionAmount,
          premium_points: 0,
          standard_points: 0,
          boost_percent: 0,
        })
        .select('total_points');

      if (insertError) {
        console.error('Failed to create commission wallet:', insertError);
        return NextResponse.json({ ok: false, error: 'Failed to create commission wallet', details: insertError.message }, { status: 500 });
      }

      console.log('Commission wallet CREATED:', targetWallet, 'with', insertData?.[0]?.total_points, 'points');

      return NextResponse.json({ 
        ok: true, 
        targetWallet,
        commission: commissionAmount,
        boostPercent,
        pointsPerTap,
        created: true
      });
    }

    // Add commission to the target wallet
    currentPoints = Number(targetUser.total_points) || 0;
    const newPoints = currentPoints + commissionAmount;

    console.log('Commission update:', { 
      targetWallet, 
      currentPoints, 
      commissionAmount, 
      newPoints,
      newPointsType: typeof newPoints 
    });

    const { data: updateData, error: updateError } = await supabase
      .from('users')
      .update({ total_points: newPoints })
      .eq('main_wallet', targetWallet)
      .select('total_points');

    if (updateError) {
      console.error('Failed to update commission:', updateError);
      return NextResponse.json({ ok: false, error: 'Failed to update commission', details: updateError.message }, { status: 500 });
    }

    // Verify update was successful
    if (!updateData || updateData.length === 0) {
      console.error('Commission update returned no data - wallet may not exist:', targetWallet);
      return NextResponse.json({ ok: false, error: 'Update returned no rows' }, { status: 500 });
    }

    console.log(`Commission SUCCESS: ${targetWallet} now has ${updateData[0].total_points} points`);

    return NextResponse.json({ 
      ok: true, 
      targetWallet,
      commission: commissionAmount,
      boostPercent,
      pointsPerTap
    });
  } catch (error) {
    console.error('Commission error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
