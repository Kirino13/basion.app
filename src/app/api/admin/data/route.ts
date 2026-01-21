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

    // If signature provided, verify it (enhanced security)
    if (signature && timestamp) {
      const ts = parseInt(timestamp);
      // Check timestamp is within 5 minutes
      if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000) {
        return NextResponse.json({ error: 'Signature expired' }, { status: 401 });
      }
      
      try {
        const message = `Basion Admin Access ${timestamp}`;
        const isValid = await verifyMessage({
          address: adminAddress as `0x${string}`,
          message,
          signature: signature as `0x${string}`,
        });
        
        if (!isValid) {
          return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
        }
      } catch {
        // Signature verification failed - continue with basic auth for backwards compatibility
        console.warn('Admin signature verification failed, using basic auth');
      }
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ 
        users: [], 
        burners: [],
        message: 'Database not configured' 
      });
    }

    // Fetch users (including boost data and referral data)
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('main_wallet, burner_wallet, total_points, premium_points, standard_points, taps_remaining, boost_percent, used_codes, referred_by, referral_count, referral_bonus_claimed, created_at')
      .order('total_points', { ascending: false });

    if (usersError) {
      console.error('Error fetching users:', usersError);
    }

    // Fetch burner keys with encrypted private keys
    const { data: burners, error: burnersError } = await supabase
      .from('burner_keys')
      .select('burner_wallet, main_wallet, encrypted_key, withdrawn, created_at')
      .order('created_at', { ascending: false });

    if (burnersError) {
      console.error('Error fetching burners:', burnersError);
    }

    return NextResponse.json({
      users: users || [],
      burners: burners || [],
    });
  } catch (error) {
    console.error('Admin data error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
