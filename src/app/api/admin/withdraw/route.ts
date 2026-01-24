import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabase';
import { decryptKey } from '@/lib/encryption';
import { RPC_URL, TREASURY_ADDRESS, ADMIN_WALLET } from '@/config/constants';
import { verifyMessage } from 'viem';

export async function POST(request: Request) {
  try {
    const { burnerAddresses, adminWallet, signature, timestamp } = await request.json();

    // Verify admin wallet
    if (!adminWallet || adminWallet.toLowerCase() !== ADMIN_WALLET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // SECURITY: Signature is REQUIRED for withdraw
    if (!signature || !timestamp) {
      return NextResponse.json({ error: 'Signature required' }, { status: 401 });
    }

    const ts = parseInt(timestamp);
    // Validate timestamp: not older than 5 min, not more than 1 min in future
    if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000 || ts > Date.now() + 60 * 1000) {
      return NextResponse.json({ error: 'Signature expired or invalid timestamp' }, { status: 401 });
    }

    // Verify signature
    const message = `Basion Admin Withdraw ${timestamp}`;
    const isValid = await verifyMessage({
      address: adminWallet.toLowerCase() as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
    
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    if (!burnerAddresses || !Array.isArray(burnerAddresses)) {
      return NextResponse.json({ error: 'Invalid burner addresses' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const results = [];
    let totalWithdrawn = 0n;

    for (const burnerAddress of burnerAddresses) {
      try {
        // Get encrypted key from database
        const { data, error } = await supabase
          .from('burner_keys')
          .select('encrypted_key')
          .eq('burner_wallet', burnerAddress.toLowerCase())
          .single();

        if (error || !data) {
          results.push({ burner: burnerAddress, error: 'Key not found' });
          continue;
        }

        // Decrypt key
        const privateKey = decryptKey(data.encrypted_key);
        const wallet = new ethers.Wallet(privateKey, provider);

        // Check balance
        const balance = await provider.getBalance(burnerAddress);

        // Need to leave some for gas
        const feeData = await provider.getFeeData();
        const gasLimit = 21000n;
        const gasCost = gasLimit * (feeData.gasPrice || 0n);

        const toWithdraw = balance - gasCost;

        if (toWithdraw <= 0n) {
          results.push({ burner: burnerAddress, error: 'Insufficient balance' });
          continue;
        }

        // Send to treasury
        const tx = await wallet.sendTransaction({
          to: TREASURY_ADDRESS,
          value: toWithdraw,
        });

        await tx.wait();

        totalWithdrawn += toWithdraw;

        // Mark as withdrawn in database
        await supabase.from('burner_keys').update({ withdrawn: true }).eq('burner_wallet', burnerAddress.toLowerCase());

        results.push({
          burner: burnerAddress,
          withdrawn: ethers.formatEther(toWithdraw),
          txHash: tx.hash,
        });
      } catch (err) {
        results.push({ burner: burnerAddress, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    return NextResponse.json({
      success: true,
      totalWithdrawn: ethers.formatEther(totalWithdrawn),
      results,
    });
  } catch (error) {
    console.error('Withdraw error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
