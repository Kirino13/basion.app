import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

const REFERRAL_BONUS = 10; // +10% boost
const MAX_REFERRALS = 5;   // Max 5 referrals = 50% boost for referrer

// POST /api/referral/claim-bonus
// Called on first tap to apply referral bonuses
// Body: { userWallet: string }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userWallet } = body;

    if (!userWallet) {
      return NextResponse.json({ error: 'Missing userWallet' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ success: true, message: 'Database not configured' });
    }

    const normalizedUser = userWallet.toLowerCase();

    // Get user data
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('referred_by, referral_bonus_claimed, boost_percent')
      .eq('main_wallet', normalizedUser)
      .single();

    if (userError && userError.code !== 'PGRST116') {
      console.error('Error fetching user:', userError);
    }

    // If no referrer or bonus already claimed, nothing to do
    if (!userData?.referred_by || userData?.referral_bonus_claimed) {
      return NextResponse.json({ 
        success: true, 
        message: 'No bonus to claim',
        bonusApplied: false 
      });
    }

    const referrerWallet = userData.referred_by;
    const currentUserBoost = userData.boost_percent || 0;

    // Start a transaction-like operation
    // 1. Apply +10% boost to the referred user (the one who was invited)
    const newUserBoost = currentUserBoost + REFERRAL_BONUS;
    
    const { error: userUpdateError } = await supabase
      .from('users')
      .update({
        boost_percent: newUserBoost,
        referral_bonus_claimed: true,
      })
      .eq('main_wallet', normalizedUser);

    if (userUpdateError) {
      console.error('Error updating user boost:', userUpdateError);
      return NextResponse.json({ error: 'Failed to apply bonus' }, { status: 500 });
    }

    // 2. Get referrer data and apply bonus if they haven't reached max
    const { data: referrerData } = await supabase
      .from('users')
      .select('boost_percent, referral_count')
      .eq('main_wallet', referrerWallet)
      .single();

    const referrerBoost = referrerData?.boost_percent || 0;
    const referrerCount = referrerData?.referral_count || 0;

    // Apply bonus to referrer if under limit
    let referrerBonusApplied = false;
    if (referrerCount < MAX_REFERRALS) {
      const newReferrerBoost = referrerBoost + REFERRAL_BONUS;
      const newReferrerCount = referrerCount + 1;

      const { error: referrerUpdateError } = await supabase
        .from('users')
        .upsert({
          main_wallet: referrerWallet,
          boost_percent: newReferrerBoost,
          referral_count: newReferrerCount,
        }, { onConflict: 'main_wallet' });

      if (referrerUpdateError) {
        console.error('Error updating referrer boost:', referrerUpdateError);
        // Don't fail the whole request, user bonus is already applied
      } else {
        referrerBonusApplied = true;
      }
    } else {
      // Referrer at max, just increment count for tracking
      await supabase
        .from('users')
        .update({ referral_count: referrerCount + 1 })
        .eq('main_wallet', referrerWallet);
    }

    return NextResponse.json({ 
      success: true, 
      bonusApplied: true,
      userBoost: newUserBoost,
      referrerBonusApplied,
      message: `+${REFERRAL_BONUS}% boost applied!`
    });
  } catch (error) {
    console.error('Referral claim bonus error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
