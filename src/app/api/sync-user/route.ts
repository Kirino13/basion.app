import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabase';
import { RPC_URL, CONTRACT_ADDRESS } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';

// Track processed txHashes to prevent replay (in-memory, resets on deploy)
const processedTxHashes = new Set<string>();

/**
 * POST /api/sync-user
 * 
 * Called after each tap from frontend to add points with boost.
 * Points are calculated: 1 × (1 + boost_percent/100) per tap.
 * 
 * Body: {
 *   mainWallet: string   - User's main wallet address
 *   txHash: string       - Transaction hash for authentication
 *   tapCount?: number    - Number of taps (default 1)
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { mainWallet, txHash, tapCount = 1 } = body;

    if (!mainWallet) {
      return NextResponse.json({ error: 'Missing mainWallet' }, { status: 400 });
    }

    if (!txHash) {
      return NextResponse.json({ error: 'Missing txHash' }, { status: 401 });
    }

    const normalizedWallet = mainWallet.toLowerCase();

    // Check if already processed (idempotent)
    if (processedTxHashes.has(txHash.toLowerCase())) {
      // Return cached points from database
      const supabase = getSupabaseAdmin();
      if (supabase) {
        const { data: userData } = await supabase
          .from('users')
          .select('total_points, premium_points, standard_points, taps_remaining, boost_percent')
          .eq('main_wallet', normalizedWallet)
          .single();
        
        return NextResponse.json({ 
          success: true, 
          cached: true,
          points: {
            total: userData?.total_points || 0,
            premium: userData?.premium_points || 0,
            standard: userData?.standard_points || 0,
          },
          tapBalance: userData?.taps_remaining || 0,
          boostPercent: userData?.boost_percent || 0,
        });
      }
      return NextResponse.json({ success: true, cached: true });
    }

    // Verify transaction
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const receipt = await provider.getTransactionReceipt(txHash);
      
      if (!receipt) {
        return NextResponse.json({ error: 'Transaction not found' }, { status: 400 });
      }

      if (receipt.status !== 1) {
        return NextResponse.json({ error: 'Transaction failed' }, { status: 400 });
      }

      if (receipt.to?.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) {
        return NextResponse.json({ error: 'Invalid contract' }, { status: 400 });
      }

      // Mark as processed
      processedTxHashes.add(txHash.toLowerCase());
      
      // Cleanup old entries
      if (processedTxHashes.size > 10000) {
        const entries = Array.from(processedTxHashes);
        entries.slice(0, 5000).forEach(h => processedTxHashes.delete(h));
      }
    } catch (verifyError) {
      console.error('TX verification error:', verifyError);
      return NextResponse.json({ error: 'Failed to verify transaction' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ success: true, message: 'Database not configured' });
    }

    // Get user's current data including boost
    const { data: userData } = await supabase
      .from('users')
      .select('total_points, premium_points, standard_points, boost_percent')
      .eq('main_wallet', normalizedWallet)
      .single();

    const currentPremium = Number(userData?.premium_points) || 0;
    const currentStandard = Number(userData?.standard_points) || 0;
    const boostPercent = Number(userData?.boost_percent) || 0;

    // Calculate points with boost: 1 × (1 + boost/100) per tap
    const pointsPerTap = 1 * (1 + boostPercent / 100);
    const pointsEarned = pointsPerTap * tapCount;

    // Add to premium points (single tap mode from UI)
    const newPremium = currentPremium + pointsEarned;
    const newTotal = newPremium + currentStandard;

    // Get tap balance from contract
    let tapBalance = 0;
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, provider);
      tapBalance = Number(await contract.tapBalance(mainWallet));
    } catch (err) {
      console.warn('Failed to read tap balance:', err);
    }

    // Update database with new points
    const { error } = await supabase.from('users').upsert(
      {
        main_wallet: normalizedWallet,
        premium_points: newPremium,
        total_points: newTotal,
        taps_remaining: tapBalance,
        last_tap_at: new Date().toISOString(),
      },
      { onConflict: 'main_wallet' }
    );

    if (error) throw error;

    return NextResponse.json({ 
      success: true,
      pointsEarned,
      boostPercent,
      points: {
        total: newTotal,
        premium: newPremium,
        standard: currentStandard,
      },
      tapBalance,
    });
  } catch (error) {
    console.error('Sync user error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
