import { NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { getSupabaseAdmin } from '@/lib/supabase';
import { encryptKey } from '@/lib/encryption';
import { CONTRACT_ADDRESS, RPC_URL } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';

// Basic rate limiting (best-effort, in-memory)
const rateLimitMap = new Map<string, { count: number; resetAt: number; blockedUntil?: number }>();
const RATE_LIMIT_MAX = 15; // allow a few retries during onboarding
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const BLOCK_DURATION = 300000; // 5 minutes

function toHex(bytes: Uint8Array): `0x${string}` {
  return (`0x${Buffer.from(bytes).toString('hex')}`) as `0x${string}`;
}

function normalizeSignature(input: unknown): `0x${string}` | null {
  if (typeof input !== 'string') return null;
  const sig = input.trim();
  if (!sig) return null;

  // Standard hex signature
  if (sig.startsWith('0x')) {
    if (/^0x[a-fA-F0-9]+$/.test(sig)) return sig as `0x${string}`;
    return null;
  }

  // Hex without 0x prefix
  if (/^[a-fA-F0-9]+$/.test(sig)) {
    return (`0x${sig}`) as `0x${string}`;
  }

  // Base64 / base64url (some in-app wallets return this)
  const b64 = sig.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
  try {
    const buf = Buffer.from(padded, 'base64');
    if (buf.length === 64 || buf.length === 65) {
      return toHex(new Uint8Array(buf));
    }
  } catch {
    // fallthrough
  }

  return null;
}

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
 *  signature?: string,
 *  timestamp?: string,
 *  txHash?: string
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
    const { mainWallet, burnerWallet, privateKey, signature, timestamp, txHash } = body ?? {};

    if (!mainWallet || !burnerWallet || !privateKey || (!txHash && (!signature || !timestamp))) {
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

    // Used for txHash verification & smart-account message verification (ERC-1271).
    const client = createPublicClient({
      chain: base,
      transport: http(RPC_URL),
    });

    // Authenticate request:
    // - Preferred: txHash proof (works in Base App even if signMessage is unreliable)
    // - Fallback: signature proof (EOA wallets)
    if (txHash) {
      const hash = String(txHash);
      if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
        return NextResponse.json({ success: false, error: 'Invalid txHash format' }, { status: 400 });
      }

      try {
        const tx = await client.getTransaction({ hash: hash as `0x${string}` });
        if (tx.from.toLowerCase() !== normalizedMain) {
          return NextResponse.json({ success: false, error: 'txHash does not match wallet' }, { status: 401 });
        }
        const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` });
        if (receipt.status !== 'success') {
          return NextResponse.json({ success: false, error: 'Transaction not successful' }, { status: 401 });
        }

        // Ensure contract state links main -> burner (prevents registering arbitrary keys)
        const userInfo = await client.readContract({
          address: CONTRACT_ADDRESS,
          abi: BASION_ABI,
          functionName: 'getUserInfo',
          args: [normalizedMain as `0x${string}`],
        });
        const contractBurner = String((userInfo as readonly [unknown, unknown, unknown])[2] ?? '').toLowerCase();
        if (!contractBurner || contractBurner === '0x0000000000000000000000000000000000000000') {
          return NextResponse.json({ success: false, error: 'No burner registered on contract' }, { status: 401 });
        }
        if (contractBurner !== normalizedBurner) {
          return NextResponse.json({ success: false, error: 'Burner mismatch' }, { status: 401 });
        }
      } catch (e) {
        console.error('txHash verification failed:', e);
        return NextResponse.json({ success: false, error: 'Failed to verify txHash' }, { status: 401 });
      }
    } else {
      const ts = parseInt(String(timestamp));
      if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000 || ts > Date.now() + 60 * 1000) {
        return NextResponse.json(
          { success: false, error: 'Signature expired or invalid timestamp' },
          { status: 401 }
        );
      }

      // Verify signature
      const message = `Register burner ${burnerWallet} for ${mainWallet} at ${timestamp}`;
      const normalizedSig = normalizeSignature(signature);
      if (!normalizedSig) {
        return NextResponse.json({ success: false, error: 'Invalid signature format' }, { status: 401 });
      }

      let isValid = false;
      try {
        // IMPORTANT: verifyMessage Action supports EOAs + smart accounts (ERC-1271).
        isValid = await client.verifyMessage({
          address: mainWallet as `0x${string}`,
          message,
          signature: normalizedSig,
        });
      } catch (e) {
        console.error('Signature verification failed:', e);
        return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 401 });
      }

      if (!isValid) {
        return NextResponse.json(
          { success: false, error: 'Invalid signature' },
          { status: 401 }
        );
      }
    }

    // Validate private key format (we store as-is; encryption validates presence of 0x prefix too)
    const pk = String(privateKey);
    if (!/^0x[a-fA-F0-9]{64}$/.test(pk)) {
      return NextResponse.json(
        { success: false, error: 'Invalid private key format' },
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
