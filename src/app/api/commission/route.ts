import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabase';
import { RPC_URL, CONTRACT_ADDRESS, COMMISSION_WALLETS as RAW_WALLETS, COMMISSION_PERCENT } from '@/config/constants';

// Normalize commission wallets to lowercase
const COMMISSION_WALLETS = RAW_WALLETS.map(w => w.toLowerCase());

// Internal token for server-to-server calls (from /api/tap)
const INTERNAL_TOKEN = process.env.COMMISSION_INTERNAL_TOKEN;

// Track processed txHashes to prevent double commission (in-memory, resets on deploy)
const processedTxHashes = new Set<string>();

/**
 * POST /api/commission
 * Adds 0.1 points to a random commission wallet per tap
 * 
 * Authentication options:
 * 1. Internal token (_token) - for server-to-server calls from /api/tap
 * 2. Transaction hash (txHash) - verified on-chain to prove real tap
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { fromWallet, _token, txHash } = body;

    if (!fromWallet) {
      return NextResponse.json({ error: 'Missing fromWallet' }, { status: 400 });
    }

    const normalizedWallet = fromWallet.toLowerCase();

    // SECURITY: Require either internal token OR valid txHash
    const hasInternalToken = INTERNAL_TOKEN && _token === INTERNAL_TOKEN;
    
    if (!hasInternalToken) {
      // No internal token - require txHash verification
      if (!txHash) {
        return NextResponse.json({ ok: false, error: 'Missing txHash' }, { status: 401 });
      }

      // Prevent replay - check if already processed
      if (processedTxHashes.has(txHash.toLowerCase())) {
        return NextResponse.json({ ok: true, skipped: true, reason: 'already_processed' });
      }

      // Verify txHash on-chain
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const receipt = await provider.getTransactionReceipt(txHash);
        
        if (!receipt) {
          return NextResponse.json({ ok: false, error: 'Transaction not found' }, { status: 400 });
        }

        // Check transaction was successful
        if (receipt.status !== 1) {
          return NextResponse.json({ ok: false, error: 'Transaction failed' }, { status: 400 });
        }

        // Check it's to the Basion contract
        if (receipt.to?.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) {
          return NextResponse.json({ ok: false, error: 'Invalid contract' }, { status: 400 });
        }

        // Mark as processed
        processedTxHashes.add(txHash.toLowerCase());
        
        // Clean up old entries (keep only last 10000)
        if (processedTxHashes.size > 10000) {
          const entries = Array.from(processedTxHashes);
          entries.slice(0, 5000).forEach(h => processedTxHashes.delete(h));
        }
      } catch (verifyError) {
        console.error('TX verification error:', verifyError);
        return NextResponse.json({ ok: false, error: 'Failed to verify transaction' }, { status: 400 });
      }
    }

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

    // Get current commission and update
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
