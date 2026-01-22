import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// Rate limiting: max 30 syncs per minute per wallet
const syncRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const SYNC_RATE_LIMIT = 30;
const SYNC_RATE_WINDOW = 60000; // 1 minute

function checkSyncRateLimit(wallet: string): boolean {
  const now = Date.now();
  const key = wallet.toLowerCase();
  const record = syncRateLimitMap.get(key);
  
  if (!record || now > record.resetAt) {
    syncRateLimitMap.set(key, { count: 1, resetAt: now + SYNC_RATE_WINDOW });
    return true;
  }
  
  if (record.count >= SYNC_RATE_LIMIT) {
    return false;
  }
  
  record.count++;
  return true;
}

// Cleanup old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of syncRateLimitMap.entries()) {
    if (now > value.resetAt) {
      syncRateLimitMap.delete(key);
    }
  }
}, 60000);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { mainWallet, points, premiumPoints, standardPoints, tapBalance } = body;

    if (!mainWallet) {
      return NextResponse.json({ error: 'Missing mainWallet' }, { status: 400 });
    }

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(mainWallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    // Rate limiting
    if (!checkSyncRateLimit(mainWallet)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ success: true, message: 'Database not configured' });
    }

    // Get existing user data to validate changes
    const { data: existingUser } = await supabase
      .from('users')
      .select('total_points, premium_points, standard_points, taps_remaining')
      .eq('main_wallet', mainWallet.toLowerCase())
      .single();

    // Build update object - only include fields with valid values
    const updateData: Record<string, unknown> = {
      main_wallet: mainWallet.toLowerCase(),
      last_tap_at: new Date().toISOString(),
    };
    
    // Update total_taps = premium_points (1 tap = 1 premium_point)
    // This represents total taps made by the user
    if (typeof premiumPoints === 'number' && premiumPoints >= 0) {
      updateData.total_taps = premiumPoints;
    }
    
    // SECURITY: Only allow points to increase, not decrease (prevents manipulation)
    // Points can only go down through legitimate game mechanics (not client sync)
    if (typeof points === 'number' && points >= 0) {
      const currentPoints = existingUser?.total_points || 0;
      // Allow increase or small decrease (due to sync timing)
      if (points >= currentPoints || currentPoints - points <= 5) {
        updateData.total_points = points;
      }
    }
    
    // Update premium points (more valuable - 1 tap = 1 tx)
    if (typeof premiumPoints === 'number' && premiumPoints >= 0) {
      const currentPremium = existingUser?.premium_points || 0;
      if (premiumPoints >= currentPremium || currentPremium - premiumPoints <= 5) {
        updateData.premium_points = premiumPoints;
      }
    }
    
    // Update standard points (batch mode)
    if (typeof standardPoints === 'number' && standardPoints >= 0) {
      const currentStandard = existingUser?.standard_points || 0;
      if (standardPoints >= currentStandard || currentStandard - standardPoints <= 5) {
        updateData.standard_points = standardPoints;
      }
    }
    
    // Tap balance can decrease (when tapping) - validate it's not increasing without deposit
    if (typeof tapBalance === 'number' && tapBalance >= 0) {
      const currentTaps = existingUser?.taps_remaining || 0;
      // Only allow decrease or same (taps used), not arbitrary increase
      if (tapBalance <= currentTaps || currentTaps === 0) {
        updateData.taps_remaining = tapBalance;
      }
    }

    const { error } = await supabase.from('users').upsert(
      updateData,
      { onConflict: 'main_wallet' }
    );

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Sync user error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
