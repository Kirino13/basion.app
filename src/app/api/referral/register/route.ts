import { NextResponse } from 'next/server';
import { verifyMessage } from 'viem';
import { ethers } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabase';
import { RPC_URL, CONTRACT_ADDRESS } from '@/config/constants';

// Track processed txHashes to prevent duplicate referrals (in-memory)
const processedTxHashes = new Set<string>();

// POST /api/referral/register
// Called when user makes first deposit with a referrer
// Body: { userWallet: string, referrerWallet: string, signature?: string, timestamp?: string, txHash?: string }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userWallet, referrerWallet, signature, timestamp, txHash } = body;

    if (!userWallet) {
      return NextResponse.json({ error: 'Missing userWallet' }, { status: 400 });
    }

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userWallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
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

      const message = `Basion referral for ${userWallet} at ${timestamp}`;
      let isValid = false;
      try {
        isValid = await verifyMessage({
          address: userWallet as `0x${string}`,
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
        
        // Cleanup old hashes
        if (processedTxHashes.size > 10000) {
          const entries = Array.from(processedTxHashes);
          entries.slice(0, 5000).forEach(h => processedTxHashes.delete(h));
        }
      } catch (verifyError) {
        return NextResponse.json({ error: 'Transaction verification failed' }, { status: 400 });
      }
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ success: true, message: 'Database not configured' });
    }

    const normalizedUser = userWallet.toLowerCase();
    const normalizedReferrer = referrerWallet?.toLowerCase();

    // Check if user already has a referrer
    const { data: existingUser } = await supabase
      .from('users')
      .select('referred_by')
      .eq('main_wallet', normalizedUser)
      .single();

    // Don't overwrite existing referrer
    if (existingUser?.referred_by) {
      return NextResponse.json({ success: true, message: 'Referrer already set' });
    }

    // Validate referrer
    const isValidReferrer = normalizedReferrer && 
      normalizedReferrer !== normalizedUser &&
      normalizedReferrer !== '0x0000000000000000000000000000000000000000' &&
      normalizedReferrer.startsWith('0x') &&
      normalizedReferrer.length === 42;

    if (!isValidReferrer) {
      return NextResponse.json({ success: true, message: 'No valid referrer' });
    }

    // Save referrer
    const { error } = await supabase
      .from('users')
      .upsert({
        main_wallet: normalizedUser,
        referred_by: normalizedReferrer,
        referral_bonus_claimed: false,
      }, { onConflict: 'main_wallet' });

    if (error) {
      console.error('Error saving referrer:', error);
      return NextResponse.json({ error: 'Failed to save referrer' }, { status: 500 });
    }

    return NextResponse.json({ success: true, referrer: normalizedReferrer });
  } catch (error) {
    console.error('Referral register error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
