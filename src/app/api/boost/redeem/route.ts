import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabase';
import { CONTRACT_ADDRESS, RPC_URL } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';

// Owner private key for calling setBoost on contract
const OWNER_PRIVATE_KEY = process.env.OWNER_PRIVATE_KEY;

// Rate limiting to prevent brute-force attacks
const rateLimitMap = new Map<string, { count: number; resetAt: number; blockedUntil?: number }>();
const RATE_LIMIT_MAX = 5; // Max attempts per window
const RATE_LIMIT_WINDOW = 60000; // 1 minute window
const BLOCK_DURATION = 300000; // 5 minute block after too many failures

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  
  // Check if blocked
  if (record?.blockedUntil && now < record.blockedUntil) {
    return { allowed: false, retryAfter: Math.ceil((record.blockedUntil - now) / 1000) };
  }
  
  // Reset window if expired
  if (!record || now > record.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true };
  }
  
  // Check if over limit
  if (record.count >= RATE_LIMIT_MAX) {
    record.blockedUntil = now + BLOCK_DURATION;
    return { allowed: false, retryAfter: Math.ceil(BLOCK_DURATION / 1000) };
  }
  
  record.count++;
  return { allowed: true };
}

// Boost codes from environment
// Format: CODE1:AMOUNT,CODE2:AMOUNT (e.g., "BONUS20:20,VIP50:50")
const BOOST_CODES_RAW = process.env.BOOST_CODES || 'MAVRINO40413:20';
const BOOST_CODES = new Map<string, number>(
  BOOST_CODES_RAW.split(',').map(entry => {
    const [code, amount] = entry.split(':');
    return [code.trim().toUpperCase(), parseInt(amount) || 20];
  })
);

// POST /api/boost/redeem
// Body: { address: string, code: string }
export async function POST(request: Request) {
  try {
    // Rate limiting by IP
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const rateCheck = checkRateLimit(ip);
    
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { ok: false, error: 'RATE_LIMIT_EXCEEDED', retryAfter: rateCheck.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfter) } }
      );
    }
    
    const body = await request.json();
    const { address, code } = body;

    if (!address || !code) {
      return NextResponse.json({ ok: false, error: 'MISSING_PARAMS' }, { status: 400 });
    }

    const normalizedAddress = address.toLowerCase();
    const normalizedCode = code.trim().toUpperCase();

    // Validate code
    const boostAmount = BOOST_CODES.get(normalizedCode);
    if (!boostAmount) {
      return NextResponse.json({ ok: false, error: 'INVALID_CODE' });
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ ok: false, error: 'DATABASE_NOT_CONFIGURED' }, { status: 500 });
    }

    // Get current user data
    const { data: userData } = await supabase
      .from('users')
      .select('boost_percent, used_codes')
      .eq('main_wallet', normalizedAddress)
      .single();

    const currentBoost = userData?.boost_percent || 0;
    const usedCodes: string[] = userData?.used_codes || [];

    // Check if code already used
    if (usedCodes.includes(normalizedCode)) {
      return NextResponse.json({ ok: false, error: 'CODE_ALREADY_USED' });
    }

    // Calculate new boost (max 100%)
    const newBoost = Math.min(currentBoost + boostAmount, 100);
    const newUsedCodes = [...usedCodes, normalizedCode];

    // Update user in database
    const { error: updateError } = await supabase
      .from('users')
      .upsert({
        main_wallet: normalizedAddress,
        boost_percent: newBoost,
        used_codes: newUsedCodes,
      }, { onConflict: 'main_wallet' });

    if (updateError) {
      console.error('Boost update error:', updateError);
      return NextResponse.json({ ok: false, error: 'UPDATE_FAILED' }, { status: 500 });
    }

    // Sync boost to smart contract if owner key is configured
    let contractSynced = false;
    if (OWNER_PRIVATE_KEY) {
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const ownerWallet = new ethers.Wallet(OWNER_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, ownerWallet);
        
        // Read current multiplier from contract to avoid race conditions
        const contractRead = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, provider);
        const currentContractMultiplier = await contractRead.pointsMultiplier(address);
        const baseMultiplier = Number(currentContractMultiplier) || 100;
        
        // Convert boost percent to multiplier (20% boost = 120 multiplier)
        // Use the maximum of current contract value and new calculated value
        const calculatedMultiplier = 100 + newBoost;
        const newMultiplier = Math.max(baseMultiplier, calculatedMultiplier);
        
        // Only update if the new value is higher
        if (newMultiplier > baseMultiplier) {
          const tx = await contract.setBoost(address, newMultiplier, 0);
          await tx.wait(1);
          console.log(`Boost synced to contract: ${address} -> ${newMultiplier}x (was ${baseMultiplier})`);
        } else {
          console.log(`Boost already set in contract: ${address} -> ${baseMultiplier}x`);
        }
        
        contractSynced = true;
      } catch (contractError) {
        console.error('Failed to sync boost to contract:', contractError);
        // Continue anyway - DB is updated, contract sync is best-effort
      }
    } else {
      console.warn('OWNER_PRIVATE_KEY not set - boost not synced to contract');
    }

    return NextResponse.json({ 
      ok: true, 
      boostPercent: newBoost,
      addedBoost: boostAmount,
      contractSynced
    });
  } catch (error) {
    console.error('Boost redeem error:', error);
    return NextResponse.json(
      { ok: false, error: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
