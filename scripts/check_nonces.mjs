import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

// Load .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const vars = {};
for (const line of envContent.split('\n')) {
  const eq = line.indexOf('=');
  if (eq > 0) vars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}

const RPC = vars.NEXT_PUBLIC_RPC_URL || 'https://mainnet.base.org';
const supabase = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_KEY);

// Get all burner wallets
const { data: burners } = await supabase.from('burner_keys').select('main_wallet, burner_wallet');
console.log(`Found ${burners.length} burner wallets\n`);

for (const b of burners) {
  const body = JSON.stringify({ jsonrpc: '2.0', method: 'eth_getTransactionCount', params: [b.burner_wallet, 'latest'], id: 1 });
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const d = await res.json();
  const nonce = parseInt(d.result, 16);
  console.log(`main: ${b.main_wallet.slice(0, 12)}... | burner: ${b.burner_wallet} | nonce: ${nonce}`);
}
