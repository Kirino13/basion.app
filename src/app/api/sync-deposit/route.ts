import { NextResponse } from 'next/server';
import { verifyMessage } from 'viem';
import { ethers } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabase';
import { RPC_URL, CONTRACT_ADDRESS } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';

// Track processed txHashes to prevent duplicate deposits (in-memory)
const processedTxHashes = new Set<string>();

// POST /api/sync-deposit
// Body: { wallet: string, usdAmount: number, signature?: string, timestamp?: string, txHash?: string }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { wallet, usdAmount, signature, timestamp, txHash } = body;

    if (!wallet || typeof usdAmount !== 'number') {
      return NextResponse.json({ error: 'Missing wallet or usdAmount' }, { status: 400 });
    }

    // SECURITY: Require either signature OR valid txHash
    const hasSignature = signature && timestamp;
    const hasTxHash = txHash;

    if (!hasSignature && !hasTxHash) {
      return NextResponse.json({ error: 'Missing authentication (signature or txHash)' }, { status: 401 });
    }

    if (hasSignature) {
      // Option 1: Signature authentication (for bots)
      const ts = parseInt(timestamp);
      if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000 || ts > Date.now() + 60 * 1000) {
        return NextResponse.json({ error: 'Signature expired or invalid timestamp' }, { status: 401 });
      }

      const message = `Basion deposit sync ${usdAmount} USD for ${wallet} at ${timestamp}`;
      let isValid = false;
      try {
        isValid = await verifyMessage({
          address: wallet as `0x${string}`,
          message,
          signature: signature as `0x${string}`,
        });
      } catch {
        return NextResponse.json({ error: 'Invalid signature format' }, { status: 401 });
      }

      if (!isValid) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
    } else if (hasTxHash) {
      // Option 2: txHash authentication (for UI after deposit)
      if (processedTxHashes.has(txHash.toLowerCase())) {
        return NextResponse.json({ success: true, cached: true });
      }

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

        processedTxHashes.add(txHash.toLowerCase());
        
        if (processedTxHashes.size > 10000) {
          const entries = Array.from(processedTxHashes);
          entries.slice(0, 5000).forEach(h => processedTxHashes.delete(h));
        }
      } catch (verifyError) {
        console.error('TX verification error:', verifyError);
        return NextResponse.json({ error: 'Failed to verify transaction' }, { status: 400 });
      }
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

    // Also sync tap balance from contract
    let tapBalance = 0;
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, provider);
      tapBalance = Number(await contract.tapBalance(wallet));
      
      // Update taps_remaining in database
      await supabase
        .from('users')
        .update({ taps_remaining: tapBalance })
        .eq('main_wallet', normalizedWallet);
    } catch (tapErr) {
      console.warn('Failed to sync tap balance after deposit:', tapErr);
    }

    return NextResponse.json({ 
      success: true, 
      totalDepositUsd: currentTotal + usdAmount,
      depositCount: currentCount + 1,
      tapsRemaining: tapBalance
    });
  } catch (error) {
    console.error('Sync deposit error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
