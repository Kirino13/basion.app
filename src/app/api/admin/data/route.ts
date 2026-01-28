import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { ADMIN_WALLET } from '@/config/constants';
import { verifyMessage } from 'viem';

// Rate limiting for admin API
const adminRateLimitMap = new Map<string, number>();
const ADMIN_RATE_LIMIT_WINDOW = 1000; // 1 second between requests

export async function GET(request: Request) {
  try {
    // Get admin address and signature from headers
    const adminAddress = request.headers.get('x-admin-address')?.toLowerCase();
    const signature = request.headers.get('x-admin-signature');
    const timestamp = request.headers.get('x-admin-timestamp');
    
    // Basic admin address check
    if (!adminAddress || adminAddress !== ADMIN_WALLET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Rate limiting per admin
    const lastRequest = adminRateLimitMap.get(adminAddress);
    if (lastRequest && Date.now() - lastRequest < ADMIN_RATE_LIMIT_WINDOW) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }
    adminRateLimitMap.set(adminAddress, Date.now());

    // SECURITY: Signature is REQUIRED for admin access
    if (!signature || !timestamp) {
      return NextResponse.json({ error: 'Signature required' }, { status: 401 });
    }

    const ts = parseInt(timestamp);
    // Validate timestamp: not older than 5 min, not more than 1 min in future
    if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000 || ts > Date.now() + 60 * 1000) {
      return NextResponse.json({ error: 'Signature expired or invalid timestamp' }, { status: 401 });
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

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ 
        users: [], 
        burners: [],
        message: 'Database not configured' 
      });
    }

    // Fetch users (including boost data, referral data, ban status, deposits)
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('main_wallet, burner_wallet, total_points, premium_points, standard_points, taps_remaining, boost_percent, used_codes, referred_by, referral_count, referral_bonus_claimed, is_banned, banned_at, total_deposit_usd, deposit_count, commission_points, created_at')
      .order('total_points', { ascending: false });

    if (usersError) {
      console.error('Error fetching users:', usersError);
    }

    // Fetch burner keys with encrypted private keys
    const { data: burners, error: burnersError } = await supabase
      .from('burner_keys')
      .select('burner_wallet, main_wallet, encrypted_key, withdrawn, created_at');

    if (burnersError) {
      console.error('Error fetching burners:', burnersError);
    }

    // Sort burners by taps_remaining from users table (descending)
    let sortedBurners = burners || [];
    if (users && burners) {
      const userTapsMap = new Map<string, number>();
      for (const user of users) {
        userTapsMap.set(user.main_wallet, user.taps_remaining || 0);
      }
      sortedBurners = [...burners].sort((a, b) => {
        const tapsA = userTapsMap.get(a.main_wallet) || 0;
        const tapsB = userTapsMap.get(b.main_wallet) || 0;
        return tapsB - tapsA; // Descending
      });
    }

    return NextResponse.json({
      users: users || [],
      burners: sortedBurners,
    });
  } catch (error) {
    console.error('Admin data error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
