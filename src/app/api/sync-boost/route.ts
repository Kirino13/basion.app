import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabase';
import { CONTRACT_ADDRESS, RPC_URL } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';

// Owner private key for calling setBoost on contract
const OWNER_PRIVATE_KEY = process.env.OWNER_PRIVATE_KEY;

/**
 * POST /api/sync-boost
 * Syncs boost_percent from Supabase to pointsMultiplier in smart contract
 * 
 * Body: { wallet: string }
 * Returns: { synced: boolean, multiplier: number, message?: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { wallet } = body;

    if (!wallet) {
      return NextResponse.json(
        { synced: false, multiplier: 100, message: 'Missing wallet parameter' },
        { status: 400 }
      );
    }

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json(
        { synced: false, multiplier: 100, message: 'Invalid wallet address' },
        { status: 400 }
      );
    }

    const normalizedWallet = wallet.toLowerCase();

    // Get Supabase client
    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ 
        synced: false, 
        multiplier: 100, 
        message: 'Database not configured' 
      });
    }

    // Get boost_percent from database
    const { data: userData } = await supabase
      .from('users')
      .select('boost_percent')
      .eq('main_wallet', normalizedWallet)
      .single();

    const boostPercent = userData?.boost_percent || 0;
    const expectedMultiplier = 100 + boostPercent;

    // Check if OWNER_PRIVATE_KEY is configured
    if (!OWNER_PRIVATE_KEY) {
      console.warn('OWNER_PRIVATE_KEY not set - cannot sync boost to contract');
      return NextResponse.json({ 
        synced: false, 
        multiplier: expectedMultiplier,
        message: 'Server not configured for contract sync'
      });
    }

    // Create provider and read current contract multiplier
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contractRead = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, provider);
    
    let currentMultiplier: number;
    try {
      const multiplierBN = await contractRead.pointsMultiplier(wallet);
      currentMultiplier = Number(multiplierBN);
      // Default to 100 if not set
      if (currentMultiplier === 0) currentMultiplier = 100;
    } catch (err) {
      console.error('Failed to read pointsMultiplier:', err);
      return NextResponse.json({ 
        synced: false, 
        multiplier: expectedMultiplier,
        message: 'Failed to read from contract'
      });
    }

    // Check if sync is needed
    if (currentMultiplier === expectedMultiplier) {
      return NextResponse.json({ 
        synced: true, 
        multiplier: currentMultiplier,
        message: 'Already in sync'
      });
    }

    // Sync is needed - call setBoost
    try {
      const ownerWallet = new ethers.Wallet(OWNER_PRIVATE_KEY, provider);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, ownerWallet);
      
      console.log(`Syncing boost: ${wallet} from ${currentMultiplier} to ${expectedMultiplier}`);
      
      const tx = await contract.setBoost(wallet, expectedMultiplier, 0);
      await tx.wait(1);
      
      console.log(`Boost synced successfully: ${wallet} -> ${expectedMultiplier}x`);
      
      return NextResponse.json({ 
        synced: true, 
        multiplier: expectedMultiplier,
        message: `Synced from ${currentMultiplier} to ${expectedMultiplier}`,
        txHash: tx.hash
      });
    } catch (contractError) {
      console.error('Failed to sync boost to contract:', contractError);
      return NextResponse.json({ 
        synced: false, 
        multiplier: currentMultiplier,
        message: 'Contract sync transaction failed'
      });
    }
  } catch (error) {
    console.error('Sync boost error:', error);
    return NextResponse.json(
      { synced: false, multiplier: 100, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
