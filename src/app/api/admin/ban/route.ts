import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { ADMIN_WALLET } from '@/config/constants';
import { verifyMessage } from 'viem';

// POST /api/admin/ban
// Body: { wallets: string[], action: 'ban' | 'unban' }
// Headers: x-admin-address, x-admin-signature, x-admin-timestamp
export async function POST(request: Request) {
  try {
    // Verify admin
    const adminAddress = request.headers.get('x-admin-address')?.toLowerCase();
    const signature = request.headers.get('x-admin-signature');
    const timestamp = request.headers.get('x-admin-timestamp');

    if (!adminAddress || adminAddress !== ADMIN_WALLET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Verify signature
    if (!signature || !timestamp) {
      return NextResponse.json({ error: 'Signature required' }, { status: 401 });
    }

    const ts = parseInt(timestamp);
    if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Signature expired' }, { status: 401 });
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

    const body = await request.json();
    const { wallets, action } = body;

    if (!wallets || !Array.isArray(wallets) || wallets.length === 0) {
      return NextResponse.json({ error: 'Missing wallets array' }, { status: 400 });
    }

    if (!action || !['ban', 'unban'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action (ban/unban)' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const isBanned = action === 'ban';
    const normalizedWallets = wallets.map(w => w.toLowerCase());

    // Update ban status for each wallet
    const results = [];
    for (const wallet of normalizedWallets) {
      const { error } = await supabase
        .from('users')
        .upsert({
          main_wallet: wallet,
          is_banned: isBanned,
          banned_at: isBanned ? new Date().toISOString() : null,
        }, { onConflict: 'main_wallet' });

      results.push({ wallet, success: !error, error: error?.message });
    }

    const successCount = results.filter(r => r.success).length;

    return NextResponse.json({
      success: true,
      action,
      processed: successCount,
      total: normalizedWallets.length,
      results,
    });
  } catch (error) {
    console.error('Admin ban error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/admin/ban?wallet=0x...
// Check if a wallet is banned (public endpoint for tap verification)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet');

    if (!wallet) {
      return NextResponse.json({ error: 'Missing wallet' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ isBanned: false });
    }

    const { data } = await supabase
      .from('users')
      .select('is_banned')
      .eq('main_wallet', wallet.toLowerCase())
      .single();

    return NextResponse.json({ 
      isBanned: data?.is_banned || false,
      wallet: wallet.toLowerCase()
    });
  } catch (error) {
    console.error('Ban check error:', error);
    return NextResponse.json({ isBanned: false });
  }
}
