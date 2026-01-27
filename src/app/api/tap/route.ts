import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { verifyMessage } from 'viem';
import { getSupabaseAdmin } from '@/lib/supabase';
import { decryptKey } from '@/lib/encryption';
import { isGasTooHigh } from '@/lib/gasPrice';
import { CONTRACT_ADDRESS, RPC_URL, COMMISSION_WALLETS as RAW_WALLETS, COMMISSION_PERCENT } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';

// Normalize commission wallets to lowercase
const COMMISSION_WALLETS = RAW_WALLETS.map(w => w.toLowerCase());

// Owner private key for auto-sync boost to contract
const OWNER_PRIVATE_KEY = process.env.OWNER_PRIVATE_KEY;

/**
 * POST /api/tap
 * 
 * External API for bots to send taps.
 * 
 * Body: {
 *   wallet: string      - Main wallet address
 *   signature: string   - Signature of message "Basion tap for {wallet} at {timestamp}"
 *   timestamp: string   - Unix timestamp in milliseconds
 *   count?: number      - Optional: number of taps (1-100), defaults to 1
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { wallet, signature, timestamp, count = 1 } = body;

    // Validate required fields
    if (!wallet || !signature || !timestamp) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: wallet, signature, timestamp' },
        { status: 400 }
      );
    }

    const normalizedWallet = wallet.toLowerCase();

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(normalizedWallet)) {
      return NextResponse.json(
        { success: false, error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    // Validate count
    const tapCount = Math.floor(Number(count));
    if (isNaN(tapCount) || tapCount < 1 || tapCount > 100) {
      return NextResponse.json(
        { success: false, error: 'Count must be between 1 and 100' },
        { status: 400 }
      );
    }

    // Verify timestamp is recent (within 5 minutes, not more than 1 min in future)
    const ts = parseInt(timestamp);
    if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000 || ts > Date.now() + 60 * 1000) {
      return NextResponse.json(
        { success: false, error: 'Signature expired or invalid timestamp' },
        { status: 401 }
      );
    }

    // Verify signature - proves ownership of wallet
    const message = `Basion tap for ${wallet} at ${timestamp}`;
    let isValid = false;
    try {
      isValid = await verifyMessage({
        address: wallet as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid signature format' },
        { status: 401 }
      );
    }

    if (!isValid) {
      return NextResponse.json(
        { success: false, error: 'Invalid signature' },
        { status: 401 }
      );
    }

    // Check gas price - block taps when network is congested
    const gasTooHigh = await isGasTooHigh();
    if (gasTooHigh) {
      return NextResponse.json(
        { success: false, error: 'Network congested. Gas too high. Try again later.' },
        { status: 503 }
      );
    }

    // Get Supabase client
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Database not configured' },
        { status: 500 }
      );
    }

    // Check if wallet is banned and get boost_percent for sync
    const { data: userData } = await supabase
      .from('users')
      .select('is_banned, boost_percent')
      .eq('main_wallet', normalizedWallet)
      .single();

    if (userData?.is_banned) {
      return NextResponse.json(
        { success: false, error: 'Wallet is banned from tapping' },
        { status: 403 }
      );
    }

    // Get burner key from database
    const { data: burnerData, error: fetchError } = await supabase
      .from('burner_keys')
      .select('burner_wallet, encrypted_key')
      .eq('main_wallet', normalizedWallet)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (fetchError || !burnerData) {
      return NextResponse.json(
        { success: false, error: 'No burner wallet found. Please deposit first via the dApp.' },
        { status: 404 }
      );
    }

    // Decrypt burner private key
    let burnerPrivateKey: string;
    try {
      burnerPrivateKey = decryptKey(burnerData.encrypted_key);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Failed to decrypt burner key' },
        { status: 500 }
      );
    }

    // Create provider and wallet
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const burnerWallet = new ethers.Wallet(burnerPrivateKey, provider);

    // Verify burner address matches
    if (burnerWallet.address.toLowerCase() !== burnerData.burner_wallet.toLowerCase()) {
      return NextResponse.json(
        { success: false, error: 'Burner key mismatch' },
        { status: 500 }
      );
    }

    // Check burner has enough gas
    const balance = await provider.getBalance(burnerData.burner_wallet);
    const feeData = await provider.getFeeData();
    const estimatedGas = BigInt(50000 + tapCount * 5000);
    const gasCost = estimatedGas * (feeData.gasPrice || 0n);

    if (balance < gasCost) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Insufficient gas on burner. Balance: ${ethers.formatEther(balance)} ETH`,
          burnerBalance: ethers.formatEther(balance)
        },
        { status: 400 }
      );
    }

    // Auto-sync boost to contract before tap (ensures DB and contract are in sync)
    if (OWNER_PRIVATE_KEY && userData?.boost_percent !== undefined) {
      try {
        const expectedMultiplier = 100 + (userData.boost_percent || 0);
        const contractRead = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, provider);
        const currentMultiplier = await contractRead.pointsMultiplier(wallet);
        
        if (Number(currentMultiplier) !== expectedMultiplier) {
          const ownerWallet = new ethers.Wallet(OWNER_PRIVATE_KEY, provider);
          const ownerContract = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, ownerWallet);
          const syncTx = await ownerContract.setBoost(wallet, expectedMultiplier, 0);
          await syncTx.wait(1);
          console.log(`Auto-synced boost: ${wallet} -> ${expectedMultiplier}`);
        }
      } catch (syncErr) {
        console.warn('Boost auto-sync failed:', syncErr);
        // Continue anyway - tap will work, just with old multiplier
      }
    }

    // Create contract instance
    const contract = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, burnerWallet);

    // Send tap transaction
    let tx: ethers.TransactionResponse;
    try {
      if (tapCount === 1) {
        tx = await contract.tap();
      } else {
        tx = await contract.batchTap(tapCount);
      }
    } catch (txError) {
      const errorMessage = txError instanceof Error ? txError.message : 'Unknown error';
      
      if (errorMessage.includes('No taps remaining')) {
        return NextResponse.json(
          { success: false, error: 'No taps remaining. Please deposit more.' },
          { status: 400 }
        );
      }
      if (errorMessage.includes('Not registered')) {
        return NextResponse.json(
          { success: false, error: 'Burner not registered. Please re-deposit via dApp.' },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { success: false, error: `Transaction failed: ${errorMessage}` },
        { status: 500 }
      );
    }

    // Wait for confirmation
    try {
      await tx.wait(1);
    } catch {
      console.warn('Transaction sent but confirmation wait failed');
    }

    // Calculate points with boost (off-chain decimal points)
    const boostPercent = userData?.boost_percent || 0;
    const pointsPerTap = 1 * (1 + boostPercent / 100); // e.g., 30% boost = 1.3 points
    const pointsEarned = pointsPerTap * tapCount;

    // Get current points from database and add new points
    let syncedPoints = { premium: 0, standard: 0, tapBalance: 0, totalPoints: 0, pointsEarned };
    try {
      // Read current points from DB
      const { data: currentUser } = await supabase
        .from('users')
        .select('premium_points, standard_points, total_points')
        .eq('main_wallet', normalizedWallet)
        .single();

      const currentPremium = Number(currentUser?.premium_points) || 0;
      const currentStandard = Number(currentUser?.standard_points) || 0;
      
      // Add new points (premium for single taps, standard for batch)
      const newPremium = tapCount === 1 ? currentPremium + pointsEarned : currentPremium;
      const newStandard = tapCount > 1 ? currentStandard + pointsEarned : currentStandard;
      const newTotal = newPremium + newStandard;

      // Get tap balance from contract
      const contractRead = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, provider);
      const newTapBalance = await contractRead.tapBalance(wallet);

      syncedPoints = {
        premium: newPremium,
        standard: newStandard,
        tapBalance: Number(newTapBalance),
        totalPoints: newTotal,
        pointsEarned,
      };

      // Update database with new points
      await supabase.from('users').upsert(
        {
          main_wallet: normalizedWallet,
          premium_points: newPremium,
          standard_points: newStandard,
          total_points: newTotal,
          taps_remaining: Number(newTapBalance),
          last_tap_at: new Date().toISOString(),
        },
        { onConflict: 'main_wallet' }
      );
    } catch (syncError) {
      console.warn('Auto-sync to DB failed:', syncError);
    }

    // Add commission to random admin wallet
    if (!COMMISSION_WALLETS.includes(normalizedWallet)) {
      try {
        const commissionAmount = tapCount * COMMISSION_PERCENT;
        const randomIndex = Math.floor(Math.random() * COMMISSION_WALLETS.length);
        const targetWallet = COMMISSION_WALLETS[randomIndex];

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
      } catch (commError) {
        console.warn('Commission failed:', commError);
      }
    }

    return NextResponse.json({
      success: true,
      txHash: tx.hash,
      count: tapCount,
      burnerAddress: burnerData.burner_wallet,
      points: syncedPoints,
      pointsEarned: syncedPoints.pointsEarned,
      boostPercent,
    });

  } catch (error) {
    console.error('Tap API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET - Returns API documentation
export async function GET() {
  return NextResponse.json({
    name: 'Basion Tap API',
    version: '1.0',
    endpoints: {
      '/api/tap': {
        method: 'POST',
        description: 'Send taps using your burner wallet',
        body: {
          wallet: 'Your main wallet address (0x...)',
          signature: 'Signature of: "Basion tap for {wallet} at {timestamp}"',
          timestamp: 'Unix timestamp in milliseconds',
          count: 'Optional: 1-100 taps, default 1',
        },
      },
      '/api/user/{address}': {
        method: 'GET',
        description: 'Get user status: points, taps remaining, boost, etc.',
      },
      '/api/get-burner': {
        method: 'GET',
        description: 'Check if user has a burner wallet',
        query: { wallet: 'Main wallet address' },
      },
    },
    notes: [
      'Deposit must be made via the dApp first to create a burner wallet',
      'Burner wallet must have ETH for gas fees',
      'Signature proves ownership of wallet - sign with main wallet',
    ],
  });
}
