import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || '';

// Debug logging (only on server)
if (typeof window === 'undefined') {
  console.log('Supabase config check:', {
    hasUrl: !!supabaseUrl,
    urlStart: supabaseUrl ? supabaseUrl.slice(0, 30) + '...' : 'MISSING',
    hasAnonKey: !!supabaseAnonKey,
    anonKeyStart: supabaseAnonKey ? supabaseAnonKey.slice(0, 20) + '...' : 'MISSING',
    hasServiceKey: !!supabaseServiceKey,
    serviceKeyStart: supabaseServiceKey ? supabaseServiceKey.slice(0, 20) + '...' : 'MISSING',
  });
}

// Client-side (limited access)
export const supabaseClient = supabaseUrl && supabaseAnonKey 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Server-side (full access) - only use in API routes
export function getSupabaseAdmin() {
  if (!supabaseUrl || !supabaseServiceKey) {
    console.log('getSupabaseAdmin: Missing config', { hasUrl: !!supabaseUrl, hasServiceKey: !!supabaseServiceKey });
    return null;
  }
  return createClient(supabaseUrl, supabaseServiceKey);
}
