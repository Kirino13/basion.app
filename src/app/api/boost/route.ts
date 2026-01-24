import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// GET /api/boost?address=0x...
// Returns the boost percentage for a user
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');

    if (!address) {
      return NextResponse.json({ error: 'Missing address', boostPercent: 0 }, { status: 400 });
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json({ error: 'Invalid address', boostPercent: 0 }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ boostPercent: 0, totalPoints: 0 });
    }

    const { data, error } = await supabase
      .from('users')
      .select('boost_percent, total_points')
      .eq('main_wallet', address.toLowerCase())
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Boost fetch error:', error);
    }

    return NextResponse.json({ 
      boostPercent: data?.boost_percent || 0,
      totalPoints: data?.total_points || 0
    });
  } catch (error) {
    console.error('Boost API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', boostPercent: 0 },
      { status: 500 }
    );
  }
}
