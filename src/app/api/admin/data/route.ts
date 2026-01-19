import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { ADMIN_WALLET } from '@/config/constants';

export async function GET(request: Request) {
  try {
    // Verify admin wallet from header
    const adminAddress = request.headers.get('x-admin-address')?.toLowerCase();
    
    if (!adminAddress || adminAddress !== ADMIN_WALLET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ 
        users: [], 
        burners: [],
        message: 'Database not configured' 
      });
    }

    // Fetch users
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('main_wallet, burner_wallet, total_points, premium_points, standard_points, taps_remaining, created_at')
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
