import { NextResponse } from 'next/server';
import { verifyMessage } from 'viem';
import { ethers } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabase';
import { RPC_URL, CONTRACT_ADDRESS } from '@/config/constants';

// Track processed txHashes to prevent replay (in-memory, resets on deploy)
const processedTxHashes = new Set<string>();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { mainWallet, points, premiumPoints, standardPoints, tapBalance, signature, timestamp, txHash } = body;

    if (!mainWallet) {
      return NextResponse.json({ error: 'Missing mainWallet' }, { status: 400 });
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

      const message = `Basion sync for ${mainWallet} at ${timestamp}`;
      let isValid = false;
      try {
        isValid = await verifyMessage({
          address: mainWallet as `0x${string}`,
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
      // Option 2: txHash authentication (for UI after tap)
      if (processedTxHashes.has(txHash.toLowerCase())) {
        // Already processed - silently accept (idempotent)
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
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ success: true, message: 'Database not configured' });
    }

    // Build update object - only include fields with valid values
    const updateData: Record<string, unknown> = {
      main_wallet: mainWallet.toLowerCase(),
      last_tap_at: new Date().toISOString(),
    };
    
    // Update total points (premium + standard)
    if (typeof points === 'number' && points >= 0) {
      updateData.total_points = points;
    }
    
    // Update premium points (more valuable - 1 tap = 1 tx)
    if (typeof premiumPoints === 'number' && premiumPoints >= 0) {
      updateData.premium_points = premiumPoints;
    }
    
    // Update standard points (batch mode)
    if (typeof standardPoints === 'number' && standardPoints >= 0) {
      updateData.standard_points = standardPoints;
    }
    
    // Update tap balance
    if (typeof tapBalance === 'number' && tapBalance >= 0) {
      updateData.taps_remaining = tapBalance;
    }

    const { error } = await supabase.from('users').upsert(
      updateData,
      { onConflict: 'main_wallet' }
    );

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Sync user error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
