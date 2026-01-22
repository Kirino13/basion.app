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
    // premiumTaps and standardTaps are TAP COUNTS from contract (not boosted)
    const { mainWallet, premiumPoints: premiumTaps, standardPoints: standardTaps, tapBalance } = body;

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

    // Get existing user data including boost and tap counts
    const { data: existingUser } = await supabase
      .from('users')
      .select('total_taps, premium_points, standard_points, boost_percent, taps_remaining')
      .eq('main_wallet', mainWallet.toLowerCase())
      .single();

    // Get user's current boost percentage
    const boostPercent = existingUser?.boost_percent || 0;
    const boostMultiplier = 1 + boostPercent / 100;

    // Build update object
    const updateData: Record<string, unknown> = {
      main_wallet: mainWallet.toLowerCase(),
      last_tap_at: new Date().toISOString(),
    };

    // Calculate new PREMIUM points with boost
    // Contract gives us tap count, we convert to points with boost
    if (typeof premiumTaps === 'number' && premiumTaps >= 0) {
      const oldTotalTaps = existingUser?.total_taps || 0;
      const newTaps = Math.max(0, premiumTaps - oldTotalTaps);
      
      if (newTaps > 0) {
        // Calculate points to add with boost
        const pointsToAdd = newTaps * boostMultiplier;
        const currentPremiumPoints = existingUser?.premium_points || 0;
        
        updateData.premium_points = currentPremiumPoints + pointsToAdd;
      }
      
      // Always update total_taps to sync with contract
      updateData.total_taps = premiumTaps;
    }

    // Calculate new STANDARD points with boost (for batch taps)
    if (typeof standardTaps === 'number' && standardTaps >= 0) {
      // For standard points, we don't have a separate tap counter
      // So we track the delta based on the incoming value
      const currentStandardPoints = existingUser?.standard_points || 0;
      
      // Standard taps from contract - apply boost
      // Note: This assumes standardTaps is cumulative from contract
      const boostedStandardPoints = standardTaps * boostMultiplier;
      
      if (boostedStandardPoints > currentStandardPoints) {
        updateData.standard_points = boostedStandardPoints;
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

    // Note: total_points is calculated by DB trigger:
    // total_points = premium_points + standard_points + commission_points

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
