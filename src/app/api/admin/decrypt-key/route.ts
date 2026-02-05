import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { ADMIN_WALLET } from '@/config/constants';
import { decryptKey } from '@/lib/encryption';
import { verifyMessage } from 'viem';

// POST /api/admin/decrypt-key
// Admin-only endpoint to decrypt burner private keys
// SECURITY:
// - requires admin signature (same as /api/admin/data)
// - never accepts arbitrary encrypted blobs from client; key is fetched server-side
// - best-effort rate limiting
const adminRateLimitMap = new Map<string, number>();
const ADMIN_RATE_LIMIT_WINDOW = 1000; // 1 second between requests
export async function POST(request: Request) {
  try {
    // Get admin address from headers
    const adminAddress = request.headers.get('x-admin-address')?.toLowerCase();
    const signature = request.headers.get('x-admin-signature');
    const timestamp = request.headers.get('x-admin-timestamp');

    // Admin address check only
    if (!adminAddress || adminAddress !== ADMIN_WALLET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Rate limiting per admin
    const lastRequest = adminRateLimitMap.get(adminAddress);
    if (lastRequest && Date.now() - lastRequest < ADMIN_RATE_LIMIT_WINDOW) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }
    adminRateLimitMap.set(adminAddress, Date.now());

    // Signature is REQUIRED
    if (!signature || !timestamp) {
      return NextResponse.json({ error: 'Signature required' }, { status: 401 });
    }

    const ts = parseInt(timestamp);
    if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000 || ts > Date.now() + 60 * 1000) {
      return NextResponse.json({ error: 'Signature expired or invalid timestamp' }, { status: 401 });
    }

    const message = `Basion Admin Access ${timestamp}`;
    const isValid = await verifyMessage({
      address: adminAddress as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Body must identify which key to decrypt.
    const body = await request.json().catch(() => ({}));
    const mainWallet = typeof body?.mainWallet === 'string' ? body.mainWallet : undefined;
    const burnerWallet = typeof body?.burnerWallet === 'string' ? body.burnerWallet : undefined;

    if (!mainWallet && !burnerWallet) {
      return NextResponse.json({ error: 'Missing mainWallet or burnerWallet' }, { status: 400 });
    }

    const wallet = (burnerWallet || mainWallet) as string;
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet format' }, { status: 400 });
    }

    const query = supabase.from('burner_keys').select('encrypted_key').limit(1);
    const { data, error } = burnerWallet
      ? await query.eq('burner_wallet', burnerWallet.toLowerCase()).maybeSingle()
      : await query.eq('main_wallet', mainWallet!.toLowerCase()).maybeSingle();

    if (error) {
      console.error('Failed to fetch encrypted key:', error);
      return NextResponse.json({ error: 'Failed to fetch encrypted key' }, { status: 500 });
    }
    if (!data?.encrypted_key) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 });
    }

    try {
      const decryptedKey = decryptKey(String(data.encrypted_key));
      return NextResponse.json({ success: true, privateKey: decryptedKey });
    } catch {
      return NextResponse.json({ error: 'Failed to decrypt key' }, { status: 500 });
    }
  } catch (error) {
    console.error('Admin decrypt key error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
