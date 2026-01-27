import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Rate limiting
const userApiRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const USER_RATE_LIMIT = 30;
const USER_RATE_WINDOW = 60000;

function checkUserRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = userApiRateLimitMap.get(ip);
  
  if (!record || now > record.resetAt) {
    userApiRateLimitMap.set(ip, { count: 1, resetAt: now + USER_RATE_WINDOW });
    return true;
  }
  
  if (record.count >= USER_RATE_LIMIT) {
    return false;
  }
  
  record.count++;
  return true;
}

export async function GET(request: Request, { params }: { params: Promise<{ address: string }> }) {
  try {
    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    if (!checkUserRateLimit(ip)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const { address } = await params;
    
    // Validate address format
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
    }
    
    const normalizedAddress = address.toLowerCase();

    const supabase = getSupabaseAdmin();

    // Default response for new users
    const defaultResponse = {
      mainWallet: normalizedAddress,
      tapsRemaining: 0,
      premiumPoints: 0,
      totalPoints: 0,
      boostPercent: 0,
      isBanned: false,
      referrer: null,
    };

    // If Supabase is not configured, return default user data
    if (!supabase) {
      return NextResponse.json(defaultResponse);
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('main_wallet', normalizedAddress)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    if (!data) {
      return NextResponse.json(defaultResponse);
    }

    // Parse points as numbers to ensure decimals work correctly
    const premiumPoints = Number(data.premium_points) || 0;
    const standardPoints = Number(data.standard_points) || 0;
    const totalPoints = Number(data.total_points) || 0;
    const boostPercent = Number(data.boost_percent) || 0;

    return NextResponse.json({
      mainWallet: data.main_wallet,
      tapsRemaining: data.taps_remaining || 0,
      premiumPoints,
      totalPoints,
      boostPercent,
      pointsMultiplier: data.points_multiplier || 100,
      referrer: data.referrer_address,
      isBanned: data.is_banned || false,
    });
  } catch (error) {
    console.error('Get user error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
