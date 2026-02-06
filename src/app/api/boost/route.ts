import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getBaseAppBonusPercent, getEffectiveBoostPercent } from '@/lib/baseApp';

function jsonNoStore(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: {
      // Prevent CDN/browser caching a response for the wrong client (desktop vs Base App)
      'Cache-Control': 'no-store',
      Vary: 'User-Agent, X-Basion-Client, Sec-CH-UA-Mobile',
    },
  });
}

// GET /api/boost?address=0x...
// Returns the boost percentage for a user
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');

    if (!address) {
      return jsonNoStore({ error: 'Missing address', boostPercent: 0 }, { status: 400 });
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return jsonNoStore({ error: 'Invalid address', boostPercent: 0 }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      const baseBoostPercent = 0;
      const baseAppBonusPercent = getBaseAppBonusPercent(request.headers);
      const effectiveBoostPercent = getEffectiveBoostPercent(baseBoostPercent, request.headers);
      return jsonNoStore({
        boostPercent: baseBoostPercent,
        baseBoostPercent,
        baseAppBonusPercent,
        effectiveBoostPercent,
        totalPoints: 0,
      });
    }

    const { data, error } = await supabase
      .from('users')
      .select('boost_percent, total_points')
      .eq('main_wallet', address.toLowerCase())
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Boost fetch error:', error);
    }

    const baseBoostPercent = Number(data?.boost_percent) || 0;
    const baseAppBonusPercent = getBaseAppBonusPercent(request.headers);
    const effectiveBoostPercent = getEffectiveBoostPercent(baseBoostPercent, request.headers);

    return jsonNoStore({
      boostPercent: baseBoostPercent,
      baseBoostPercent,
      baseAppBonusPercent,
      effectiveBoostPercent,
      totalPoints: data?.total_points || 0,
    });
  } catch (error) {
    console.error('Boost API error:', error);
    return jsonNoStore({ error: 'Internal server error', boostPercent: 0 }, { status: 500 });
  }
}
