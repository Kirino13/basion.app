import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyMessage } from 'viem';

// Rate limiting: max 10 requests per minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60000; // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  
  if (!record || now > record.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  
  if (record.count >= RATE_LIMIT) {
    return false;
  }
  
  record.count++;
  return true;
}

export async function GET(request: Request) {
  try {
    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet');
    const signature = searchParams.get('signature');
    const timestamp = searchParams.get('timestamp');

    if (!wallet) {
      return NextResponse.json({ error: 'Missing wallet parameter' }, { status: 400 });
    }

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    // Get burner for this wallet (most recent if multiple exist)
    const { data, error } = await supabase
      .from('burner_keys')
      .select('burner_wallet, encrypted_key')
      .eq('main_wallet', wallet.toLowerCase())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      // No burner found - this is expected for new users
      if (error.code === 'PGRST116') {
        return NextResponse.json({ exists: false });
      }
      throw error;
    }

    // SECURITY: Only return encrypted key if request includes valid signature
    // This prevents attackers from fetching other users' encrypted keys
    // Without signature, only return existence and address (for UI display)
    if (signature && timestamp) {
      // Verify timestamp is recent (within 5 minutes)
      const ts = parseInt(timestamp);
      if (isNaN(ts) || Date.now() - ts > 5 * 60 * 1000) {
        return NextResponse.json({ 
          exists: true, 
          burnerAddress: data.burner_wallet,
          error: 'Signature expired' 
        });
      }
      
      try {
        // Verify signature
        const message = `Restore burner wallet for ${wallet} at ${timestamp}`;
        const isValid = await verifyMessage({
          address: wallet as `0x${string}`,
          message,
          signature: signature as `0x${string}`,
        });
        
        if (isValid) {
          // Signature valid - return encrypted key
          return NextResponse.json({
            exists: true,
            burnerAddress: data.burner_wallet,
            encryptedKey: data.encrypted_key,
          });
        }
      } catch (sigError) {
        console.error('Signature verification failed:', sigError);
      }
    }

    // Without valid signature, only return that burner exists (for UI purposes)
    // The encrypted key is NOT returned - user must sign to prove ownership
    return NextResponse.json({
      exists: true,
      burnerAddress: data.burner_wallet,
      // encryptedKey intentionally omitted for security
    });
  } catch (error) {
    console.error('Get burner error:', error);
    return NextResponse.json(
      { error: 'Failed to get burner' },
      { status: 500 }
    );
  }
}
