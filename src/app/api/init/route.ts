import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { verifyMessage, encodeFunctionData } from 'viem';
import { getSupabaseAdmin } from '@/lib/supabase';
import { encryptKey } from '@/lib/encryption';
import { CONTRACT_ADDRESS, RPC_URL, GAME_CONFIG } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';

// Maintenance mode
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const MAINTENANCE_MESSAGE = process.env.MAINTENANCE_MESSAGE || 'Service is under maintenance. Please try again later.';
const MAINTENANCE_RETRY_AFTER = parseInt(process.env.MAINTENANCE_RETRY_AFTER || '3600');

/**
 * POST /api/init
 * 
 * Initialize a new user for bot usage:
 * 1. Creates burner wallet (if doesn't exist)
 * 2. Saves encrypted key to database
 * 3. Returns transaction data for registerBurner and deposit
 * 
 * User must sign and send these transactions themselves.
 * 
 * Body: {
 *   wallet: string       - Main wallet address
 *   signature: string    - Signature of message "Basion init for {wallet} at {timestamp}"
 *   timestamp: string    - Unix timestamp in milliseconds
 *   packageId?: number   - Package ID (0 or 1), defaults to 0
 *   referrer?: string    - Referrer wallet address (optional)
 * }
 */
export async function POST(request: Request) {
  // Check maintenance mode FIRST
  if (MAINTENANCE_MODE) {
    return NextResponse.json(
      { 
        success: false, 
        error: 'MAINTENANCE',
        message: MAINTENANCE_MESSAGE,
        retryAfter: MAINTENANCE_RETRY_AFTER
      },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { wallet, signature, timestamp, packageId = 0, referrer = ethers.ZeroAddress } = body;

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

    // Verify timestamp is recent (within 5 minutes)
    const ts = parseInt(timestamp);
    if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000) {
      return NextResponse.json(
        { success: false, error: 'Signature expired (timestamp too old)' },
        { status: 401 }
      );
    }

    // Verify signature
    const message = `Basion init for ${wallet} at ${timestamp}`;
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

    // Validate packageId
    const pkgId = Number(packageId);
    if (![0, 1].includes(pkgId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid packageId. Must be 0 or 1' },
        { status: 400 }
      );
    }

    // Validate referrer if provided
    const refAddress = referrer === ethers.ZeroAddress ? ethers.ZeroAddress : referrer;
    if (refAddress !== ethers.ZeroAddress && !/^0x[a-fA-F0-9]{40}$/.test(refAddress)) {
      return NextResponse.json(
        { success: false, error: 'Invalid referrer address format' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Database not configured' },
        { status: 500 }
      );
    }

    // Check if burner already exists
    const { data: existingBurner } = await supabase
      .from('burner_keys')
      .select('burner_wallet')
      .eq('main_wallet', normalizedWallet)
      .single();

    let burnerAddress: string;
    let burnerCreated = false;

    if (existingBurner) {
      // Burner already exists
      burnerAddress = existingBurner.burner_wallet;
    } else {
      // Create new burner wallet
      const burnerWallet = ethers.Wallet.createRandom();
      burnerAddress = burnerWallet.address.toLowerCase();
      
      // Encrypt private key
      const encryptedKey = encryptKey(burnerWallet.privateKey);
      
      // Save to database
      const { error: insertError } = await supabase.from('burner_keys').insert({
        main_wallet: normalizedWallet,
        burner_wallet: burnerAddress,
        encrypted_key: encryptedKey,
      });

      if (insertError) {
        console.error('Failed to save burner:', insertError);
        return NextResponse.json(
          { success: false, error: 'Failed to save burner wallet' },
          { status: 500 }
        );
      }

      // Create user entry
      await supabase.from('users').upsert({
        main_wallet: normalizedWallet,
        burner_wallet: burnerAddress,
        total_points: 0,
        premium_points: 0,
        standard_points: 0,
        boost_percent: 0,
      }, { onConflict: 'main_wallet' });

      burnerCreated = true;
    }

    // Get package info
    const packageInfo = GAME_CONFIG.packages[pkgId as 0 | 1];
    const depositValue = ethers.parseEther(packageInfo.priceEth);

    // Encode registerBurner transaction data
    const registerBurnerData = encodeFunctionData({
      abi: BASION_ABI,
      functionName: 'registerBurner',
      args: [burnerAddress as `0x${string}`],
    });

    // Encode deposit transaction data
    const depositData = encodeFunctionData({
      abi: BASION_ABI,
      functionName: 'deposit',
      args: [BigInt(pkgId), refAddress as `0x${string}`],
    });

    // Check if burner is already registered in contract
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, provider);
    
    let burnerRegistered = false;
    try {
      const registeredBurner = await contract.userToBurner(normalizedWallet);
      burnerRegistered = registeredBurner.toLowerCase() === burnerAddress.toLowerCase();
    } catch {
      // Contract call failed, assume not registered
    }

    // Check tap balance
    let tapBalance = 0;
    try {
      const balance = await contract.tapBalance(normalizedWallet);
      tapBalance = Number(balance);
    } catch {
      // Ignore
    }

    return NextResponse.json({
      success: true,
      burnerAddress,
      burnerCreated,
      burnerRegistered,
      tapBalance,
      
      // Contract address
      contractAddress: CONTRACT_ADDRESS,
      rpcUrl: RPC_URL,
      chainId: 84532, // Base Sepolia
      
      // Transaction 1: registerBurner (skip if already registered)
      registerBurnerTx: burnerRegistered ? null : {
        to: CONTRACT_ADDRESS,
        data: registerBurnerData,
        value: '0',
        description: 'Register burner wallet in contract',
      },
      
      // Transaction 2: deposit
      depositTx: {
        to: CONTRACT_ADDRESS,
        data: depositData,
        value: depositValue.toString(),
        valueEth: packageInfo.priceEth,
        description: `Deposit ${packageInfo.usd}$ for ${packageInfo.taps} taps`,
        packageId: pkgId,
        taps: packageInfo.taps,
      },

      // Instructions
      instructions: [
        burnerRegistered 
          ? '1. Burner already registered - skip registerBurner'
          : '1. Sign and send registerBurnerTx from your main wallet',
        '2. Sign and send depositTx with ETH value from your main wallet',
        '3. Use /api/tap to tap after deposit confirms',
      ],
    });

  } catch (error) {
    console.error('Init API error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET - Returns API documentation
export async function GET() {
  return NextResponse.json({
    name: 'Basion Init API',
    version: '1.0',
    description: 'Initialize user for bot usage - creates burner and returns transaction data',
    
    packages: {
      0: { usd: 3, taps: 5000, priceEth: '0.001' },
      1: { usd: 10, taps: 20000, priceEth: '0.003' },
    },
    
    usage: {
      method: 'POST',
      url: '/api/init',
      body: {
        wallet: 'Your main wallet address (0x...)',
        signature: 'Signature of message: "Basion init for {wallet} at {timestamp}"',
        timestamp: 'Unix timestamp in milliseconds',
        packageId: 'Optional: 0 or 1, default 0',
        referrer: 'Optional: referrer wallet address',
      },
    },
    
    response: {
      success: 'true/false',
      burnerAddress: 'Created burner wallet address',
      burnerCreated: 'true if new burner was created',
      burnerRegistered: 'true if already registered in contract',
      registerBurnerTx: 'Transaction data for registerBurner (null if already registered)',
      depositTx: 'Transaction data for deposit',
      instructions: 'Step-by-step instructions',
    },
    
    workflow: [
      '1. Call POST /api/init with signature',
      '2. If registerBurnerTx is not null, sign and send it',
      '3. Sign and send depositTx with the specified ETH value',
      '4. Wait for transactions to confirm',
      '5. Use POST /api/tap to send taps',
    ],
  });
}
