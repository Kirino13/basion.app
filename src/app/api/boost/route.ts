import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Disable caching for real-time boost updates
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Rate limiting
const boostRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const BOOST_RATE_LIMIT = 60;
const BOOST_RATE_WINDOW = 60000;

function checkBoostRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = boostRateLimitMap.get(ip);
  
  if (!record || now > record.resetAt) {
    boostRateLimitMap.set(ip, { count: 1, resetAt: now + BOOST_RATE_WINDOW });
    return true;
  }
  
  if (record.count >= BOOST_RATE_LIMIT) {
    return false;
  }
  
  record.count++;
  return true;
}

// GET /api/boost?address=0x...
// Returns the boost percentage for a user
export async function GET(request: Request) {
  try {
    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    if (!checkBoostRateLimit(ip)) {
      return NextResponse.json({ error: 'Rate limit exceeded', boostPercent: 0 }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');

    if (!address) {
      return NextResponse.json({ error: 'Missing address' }, { status: 400 });
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json({ error: 'Invalid address', boostPercent: 0 }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      // No database - return default
      return NextResponse.json({ boostPercent: 0 });
    }

    const { data, error } = await supabase
      .from('users')
      .select('boost_percent')
      .eq('main_wallet', address.toLowerCase())
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is fine
      console.error('Boost fetch error:', error);
    }

    return NextResponse.json({ 
      boostPercent: data?.boost_percent || 0 
    });
  } catch (error) {
    console.error('Boost API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', boostPercent: 0 },
      { status: 500 }
    );
  }
}
