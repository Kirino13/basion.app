import { NextResponse } from 'next/server';
import { verifyMessage } from 'viem';
import { getSupabaseAdmin } from '@/lib/supabase';
import { encryptKey } from '@/lib/encryption';

// Basic rate limiting (best-effort, in-memory)
const rateLimitMap = new Map<string, { count: number; resetAt: number; blockedUntil?: number }>();
const RATE_LIMIT_MAX = 15; // allow a few retries during onboarding
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const BLOCK_DURATION = 300000; // 5 minutes

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (record?.blockedUntil && now < record.blockedUntil) {
    return { allowed: false, retryAfter: Math.ceil((record.blockedUntil - now) / 1000) };
  }

  if (!record || now > record.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true };
  }

  if (record.count >= RATE_LIMIT_MAX) {
    record.blockedUntil = now + BLOCK_DURATION;
    return { allowed: false, retryAfter: Math.ceil(BLOCK_DURATION / 1000) };
  }

  record.count++;
  return { allowed: true };
}

/**
 * POST /api/register-burner
 *
 * Stores burner private key encrypted server-side, linked to main wallet.
 * Requires signature from main wallet proving ownership.
 *
 * Body: {
 *  mainWallet: string,
 *  burnerWallet: string,
 *  privateKey: string,
 *  signature: string,
 *  timestamp: string
 * }
 */
export async function POST(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Please try again later.', retryAfter: rateCheck.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfter) } }
      );
    }

    const body = await request.json();
    const { mainWallet, burnerWallet, privateKey, signature, timestamp } = body ?? {};

    if (!mainWallet || !burnerWallet || !privateKey || !signature || !timestamp) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const normalizedMain = String(mainWallet).toLowerCase();
    const normalizedBurner = String(burnerWallet).toLowerCase();

    if (!/^0x[a-fA-F0-9]{40}$/.test(normalizedMain) || !/^0x[a-fA-F0-9]{40}$/.test(normalizedBurner)) {
      return NextResponse.json(
        { success: false, error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    const ts = parseInt(String(timestamp));
    if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000 || ts > Date.now() + 60 * 1000) {
      return NextResponse.json(
        { success: false, error: 'Signature expired or invalid timestamp' },
        { status: 401 }
      );
    }

    // Validate private key format (we store as-is; encryption validates presence of 0x prefix too)
    const pk = String(privateKey);
    if (!/^0x[a-fA-F0-9]{64}$/.test(pk)) {
      return NextResponse.json(
        { success: false, error: 'Invalid private key format' },
        { status: 400 }
      );
    }

    // Verify signature
    const message = `Register burner ${burnerWallet} for ${mainWallet} at ${timestamp}`;
    let isValid = false;
    try {
      isValid = await verifyMessage({
        address: mainWallet as `0x${string}`,
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

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Database not configured' },
        { status: 500 }
      );
    }

    // Encrypt private key server-side
    const encrypted = encryptKey(pk);

    // Upsert (main_wallet is PK) so re-registering doesn't break.
    const { error: keyError } = await supabase.from('burner_keys').upsert(
      {
        main_wallet: normalizedMain,
        burner_wallet: normalizedBurner,
        encrypted_key: encrypted,
      },
      { onConflict: 'main_wallet' }
    );

    if (keyError) {
      console.error('Failed to upsert burner_keys:', keyError);
      return NextResponse.json(
        { success: false, error: 'Failed to register burner' },
        { status: 500 }
      );
    }

    // Best-effort: keep users.burner_wallet in sync (doesn't affect tapping logic)
    supabase
      .from('users')
      .upsert(
        {
          main_wallet: normalizedMain,
          burner_wallet: normalizedBurner,
        },
        { onConflict: 'main_wallet' }
      )
      .then(({ error }) => {
        if (error) console.warn('Failed to upsert users burner_wallet:', error);
      });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Register burner error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
