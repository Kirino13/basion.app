import { NextResponse } from 'next/server';
import { verifyMessage } from 'viem';
import { ADMIN_WALLET } from '@/config/constants';
import { decryptKey } from '@/lib/encryption';

// POST /api/admin/decrypt-key
// Admin-only endpoint to decrypt burner private keys
// Requires signature verification
export async function POST(request: Request) {
  try {
    // Get admin address and signature from headers
    const adminAddress = request.headers.get('x-admin-address')?.toLowerCase();
    const signature = request.headers.get('x-admin-signature');
    const timestamp = request.headers.get('x-admin-timestamp');

    // Basic admin address check
    if (!adminAddress || adminAddress !== ADMIN_WALLET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // SECURITY: Signature is REQUIRED for admin access
    if (!signature || !timestamp) {
      return NextResponse.json({ error: 'Signature required' }, { status: 401 });
    }

    const ts = parseInt(timestamp);
    // Check timestamp is within 5 minutes
    if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Signature expired' }, { status: 401 });
    }

    // Verify signature
    const message = `Basion Admin Access ${timestamp}`;
    const isValid = await verifyMessage({
      address: adminAddress as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Get encrypted key from body
    const body = await request.json();
    const { encryptedKey } = body;

    if (!encryptedKey) {
      return NextResponse.json({ error: 'Missing encryptedKey' }, { status: 400 });
    }

    // Decrypt on server
    try {
      const decryptedKey = decryptKey(encryptedKey);
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
