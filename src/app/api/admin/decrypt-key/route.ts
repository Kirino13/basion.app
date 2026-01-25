import { NextResponse } from 'next/server';
import { ADMIN_WALLET } from '@/config/constants';
import { decryptKey } from '@/lib/encryption';

// POST /api/admin/decrypt-key
// Admin-only endpoint to decrypt burner private keys
// Only requires admin wallet address check (no signature)
export async function POST(request: Request) {
  try {
    // Get admin address from headers
    const adminAddress = request.headers.get('x-admin-address')?.toLowerCase();

    // Admin address check only
    if (!adminAddress || adminAddress !== ADMIN_WALLET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
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
