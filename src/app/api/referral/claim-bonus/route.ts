import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabase';
import { CONTRACT_ADDRESS, RPC_URL } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';

const REFERRAL_BONUS = 10; // +10% boost
const MAX_REFERRALS = 5;   // Max 5 referrals = 50% boost for referrer

// Owner private key for calling setBoost on contract
const OWNER_PRIVATE_KEY = process.env.OWNER_PRIVATE_KEY;

// Helper function to sync boost to contract with retry mechanism
async function syncBoostToContract(address: string, boostPercent: number, maxRetries = 3): Promise<boolean> {
  if (!OWNER_PRIVATE_KEY) {
    console.warn('OWNER_PRIVATE_KEY not set - boost not synced to contract');
    return false;
  }
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const ownerWallet = new ethers.Wallet(OWNER_PRIVATE_KEY, provider);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, ownerWallet);
      
      // Read current multiplier from contract to avoid race conditions
      const contractRead = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, provider);
      const currentContractMultiplier = await contractRead.pointsMultiplier(address);
      const baseMultiplier = Number(currentContractMultiplier) || 100;
      
      // Convert boost percent to multiplier (20% boost = 120 multiplier)
      const calculatedMultiplier = 100 + boostPercent;
      const newMultiplier = Math.max(baseMultiplier, calculatedMultiplier);
      
      // Only update if the new value is higher
      if (newMultiplier > baseMultiplier) {
        const tx = await contract.setBoost(address, newMultiplier, 0);
        await tx.wait(1);
        console.log(`Boost synced to contract: ${address} -> ${newMultiplier}x (was ${baseMultiplier})`);
      } else {
        console.log(`Boost already set in contract: ${address} -> ${baseMultiplier}x`);
      }
      
      return true;
    } catch (error) {
      console.warn(`Contract sync attempt ${attempt}/${maxRetries} failed:`, error);
      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }
  
  console.error(`Failed to sync boost to contract after ${maxRetries} retries: ${address}`);
  return false;
}

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

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userWallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ success: true, message: 'Database not configured' });
    }

    const normalizedUser = userWallet.toLowerCase();

    // Get user data
    const { data: userData } = await supabase
      .from('users')
      .select('referred_by, referral_bonus_claimed, boost_percent')
      .eq('main_wallet', normalizedUser)
      .single();

    // If bonus already claimed, return early
    if (userData?.referral_bonus_claimed) {
      return NextResponse.json({ 
        success: true, 
        message: 'Bonus already claimed',
        bonusApplied: false 
      });
    }

    let referrerWallet = userData?.referred_by;
    const currentUserBoost = userData?.boost_percent || 0;

    // Fallback: if no referrer in DB, try to get from contract
    if (!referrerWallet) {
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, provider);
        const userInfo = await contract.userInfo(userWallet);
        const contractReferrer = userInfo.referrer?.toLowerCase();
        
        if (contractReferrer && contractReferrer !== '0x0000000000000000000000000000000000000000') {
          referrerWallet = contractReferrer;
          
          // Save referrer to database for future use
          await supabase.from('users').upsert({
            main_wallet: normalizedUser,
            referred_by: contractReferrer,
          }, { onConflict: 'main_wallet' });
          
          console.log(`Referrer recovered from contract: ${normalizedUser} -> ${contractReferrer}`);
        }
      } catch (contractError) {
        console.warn('Failed to get referrer from contract:', contractError);
      }
    }

    // If still no referrer, no bonus to claim
    if (!referrerWallet) {
      return NextResponse.json({ 
        success: true, 
        message: 'No bonus to claim',
        bonusApplied: false 
      });
    }

    // Apply +10% boost to referred user
    // Use conditional update to prevent race conditions (only update if not already claimed)
    const newUserBoost = currentUserBoost + REFERRAL_BONUS;
    
    const { data: updatedUser, error: userUpdateError } = await supabase
      .from('users')
      .update({
        boost_percent: newUserBoost,
        referral_bonus_claimed: true,
      })
      .eq('main_wallet', normalizedUser)
      .eq('referral_bonus_claimed', false) // Only update if not already claimed (race condition protection)
      .select();

    if (userUpdateError) {
      console.error('Error updating user boost:', userUpdateError);
      return NextResponse.json({ error: 'Failed to apply bonus' }, { status: 500 });
    }

    // If no rows updated, bonus was already claimed by another request
    if (!updatedUser || updatedUser.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: 'Bonus already claimed (concurrent request)',
        bonusApplied: false 
      });
    }

    // Sync user boost to contract
    const userContractSynced = await syncBoostToContract(normalizedUser, newUserBoost);

    // Get referrer data and apply bonus if under limit
    const { data: referrerData } = await supabase
      .from('users')
      .select('boost_percent, referral_count')
      .eq('main_wallet', referrerWallet)
      .single();

    const referrerBoost = referrerData?.boost_percent || 0;
    const referrerCount = referrerData?.referral_count || 0;

    let referrerBonusApplied = false;
    if (referrerCount < MAX_REFERRALS) {
      const newReferrerBoost = referrerBoost + REFERRAL_BONUS;
      const newReferrerCount = referrerCount + 1;

      // Use atomic increment via RPC to prevent race conditions
      // First try to update existing user with referral_count check
      const { data: referrerUpdated, error: referrerUpdateError } = await supabase
        .from('users')
        .update({
          boost_percent: newReferrerBoost,
          referral_count: newReferrerCount,
        })
        .eq('main_wallet', referrerWallet)
        .lt('referral_count', MAX_REFERRALS) // Only if under limit (race condition protection)
        .select();

      if (!referrerUpdateError && referrerUpdated && referrerUpdated.length > 0) {
        referrerBonusApplied = true;
        // Sync referrer boost to contract
        await syncBoostToContract(referrerWallet, newReferrerBoost);
      } else if (!referrerUpdated || referrerUpdated.length === 0) {
        // User doesn't exist yet - create with bonus
        const { error: insertError } = await supabase.from('users').insert({
          main_wallet: referrerWallet,
          boost_percent: REFERRAL_BONUS,
          referral_count: 1,
        });
        if (!insertError) {
          referrerBonusApplied = true;
          await syncBoostToContract(referrerWallet, REFERRAL_BONUS);
        }
      }
    } else {
      // Just increment count (no bonus - over limit)
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
      userContractSynced,
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
