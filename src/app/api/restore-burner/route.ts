import { NextResponse } from 'next/server';
import { verifyMessage } from 'viem';
import { getSupabaseAdmin } from '@/lib/supabase';
import { decryptKey } from '@/lib/encryption';

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

/**
 * POST /api/restore-burner
 * 
 * Restore burner wallet private key for cross-device sync.
 * Requires signature from mainWallet to prove ownership.
 * 
 * Body: {
 *   wallet: string      - Main wallet address
 *   signature: string   - Signature of message "Restore Basion burner for {wallet} at {timestamp}"
 *   timestamp: string   - Unix timestamp in milliseconds
 * }
 * 
 * Returns: {
 *   success: boolean
 *   burnerAddress: string
 *   privateKey: string   - Decrypted burner private key
 * }
 */
export async function POST(request: Request) {
  try {
    // Rate limiting by IP
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const rateCheck = checkRateLimit(ip);
    
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Please try again later.', retryAfter: rateCheck.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfter) } }
      );
    }

    const body = await request.json();
    const { wallet, signature, timestamp } = body;

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

    // Verify timestamp is recent (within 5 minutes, not more than 1 min in future)
    const ts = parseInt(timestamp);
    if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000 || ts > Date.now() + 60 * 1000) {
      return NextResponse.json(
        { success: false, error: 'Signature expired or invalid timestamp' },
        { status: 401 }
      );
    }

    // Verify signature - proves ownership of wallet
    const message = `Restore Basion burner for ${wallet} at ${timestamp}`;
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
        { success: false, error: 'No burner wallet found for this address. Please deposit first.' },
        { status: 404 }
      );
    }

    // Decrypt burner private key
    let privateKey: string;
    try {
      privateKey = decryptKey(burnerData.encrypted_key);
    } catch {
      console.error('Failed to decrypt burner key for wallet:', normalizedWallet);
      return NextResponse.json(
        { success: false, error: 'Failed to decrypt burner key' },
        { status: 500 }
      );
    }

    // Success - return the decrypted key
    return NextResponse.json({
      success: true,
      burnerAddress: burnerData.burner_wallet,
      privateKey: privateKey,
    });

  } catch (error) {
    console.error('Restore burner error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
