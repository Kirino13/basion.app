import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { verifyMessage } from 'viem';
import { getSupabaseAdmin } from '@/lib/supabase';
import { decryptKey } from '@/lib/encryption';
import { tapApiLimiter, checkRateLimit } from '@/lib/rateLimit';
import { CONTRACT_ADDRESS, RPC_URL } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';

// Maintenance mode
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const MAINTENANCE_MESSAGE = process.env.MAINTENANCE_MESSAGE || 'Service is under maintenance. Please try again later.';
const MAINTENANCE_RETRY_AFTER = parseInt(process.env.MAINTENANCE_RETRY_AFTER || '3600');

/**
 * POST /api/tap
 * 
 * External API for bots to send taps without knowing contract address or database.
 * 
 * Body: {
 *   wallet: string      - Main wallet address
 *   signature: string   - Signature of message "Basion tap for {wallet} at {timestamp}"
 *   timestamp: string   - Unix timestamp in milliseconds
 *   count?: number      - Optional: number of taps (1-100), defaults to 1
 * }
 * 
 * Response: {
 *   success: boolean
 *   txHash?: string     - Transaction hash on success
 *   error?: string      - Error message on failure
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

    // Verify timestamp is recent (within 5 minutes)
    const ts = parseInt(timestamp);
    if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000) {
      return NextResponse.json(
        { success: false, error: 'Signature expired (timestamp too old)' },
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

    // Rate limiting via Upstash Redis (60 requests/min per wallet)
    const rateLimitResult = await checkRateLimit(tapApiLimiter, normalizedWallet);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded', remaining: rateLimitResult.remaining },
        { status: 429 }
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
    const estimatedGas = BigInt(50000 + tapCount * 5000); // Base + per-tap
    const gasCost = estimatedGas * (feeData.gasPrice || 0n);

    if (balance < gasCost) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Insufficient gas on burner. Balance: ${ethers.formatEther(balance)} ETH, need: ${ethers.formatEther(gasCost)} ETH`,
          burnerBalance: ethers.formatEther(balance)
        },
        { status: 400 }
      );
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
      
      // Parse common contract errors
      if (errorMessage.includes('No taps remaining')) {
        return NextResponse.json(
          { success: false, error: 'No taps remaining. Please deposit more.' },
          { status: 400 }
        );
      }
      if (errorMessage.includes('Not registered')) {
        return NextResponse.json(
          { success: false, error: 'Burner not registered in contract. Please re-deposit via dApp.' },
          { status: 400 }
        );
      }
      if (errorMessage.includes('Blacklisted')) {
        return NextResponse.json(
          { success: false, error: 'Wallet is blacklisted' },
          { status: 403 }
        );
      }

      return NextResponse.json(
        { success: false, error: `Transaction failed: ${errorMessage}` },
        { status: 500 }
      );
    }

    // Return success with transaction hash
    return NextResponse.json({
      success: true,
      txHash: tx.hash,
      count: tapCount,
      burnerAddress: burnerData.burner_wallet,
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
    description: 'External API for sending taps via your own bot',
    usage: {
      method: 'POST',
      url: '/api/tap',
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        wallet: 'Your main wallet address (0x...)',
        signature: 'Signature of message: "Basion tap for {wallet} at {timestamp}"',
        timestamp: 'Unix timestamp in milliseconds (Date.now())',
        count: 'Optional: number of taps 1-100, default 1',
      },
      response: {
        success: 'true/false',
        txHash: 'Transaction hash on success',
        error: 'Error message on failure',
      },
    },
    python_example: `
import requests
import time
from eth_account import Account
from eth_account.messages import encode_defunct

MAIN_WALLET = "0xYourMainWallet"
MAIN_PRIVATE_KEY = "0xYourPrivateKey"
API_URL = "https://basion.app/api/tap"

def tap():
    timestamp = str(int(time.time() * 1000))
    message = f"Basion tap for {MAIN_WALLET} at {timestamp}"
    
    signed = Account.sign_message(
        encode_defunct(text=message), 
        MAIN_PRIVATE_KEY
    )
    
    response = requests.post(API_URL, json={
        "wallet": MAIN_WALLET,
        "signature": signed.signature.hex(),
        "timestamp": timestamp,
        "count": 1  # or up to 100 for batch
    })
    
    return response.json()

# Usage
result = tap()
print(result)  # {"success": true, "txHash": "0x..."}
`,
    rateLimit: '60 requests per minute per wallet',
    requirements: [
      'Must have deposited via the dApp first (creates burner wallet)',
      'Burner wallet must have ETH for gas',
      'Signature must be from main wallet (proves ownership)',
    ],
  });
}
