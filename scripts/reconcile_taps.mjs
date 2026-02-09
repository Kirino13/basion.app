/**
 * reconcile_taps.mjs
 *
 * For each user with a deposit:
 *   1. Calculate total_taps_bought from deposit amounts ($3=2000, $10=7000)
 *   2. Query RPC eth_getTransactionCount for burner wallet (nonce = total outgoing txs)
 *   3. real_taps_done = min(nonce, total_taps_bought)
 *   4. new_points = real_taps_done * (1 + boost_percent / 100)
 *   5. new_taps_remaining = max(0, total_taps_bought - nonce)
 *   6. Update Supabase (premium_points, standard_points=0, taps_remaining)
 *
 * Usage:
 *   node scripts/reconcile_taps.mjs                  # dry-run (default)
 *   node scripts/reconcile_taps.mjs --apply           # actually update DB
 *   node scripts/reconcile_taps.mjs --wallet 0x...    # single wallet only
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

// ── Load .env.local ──────────────────────────────────────────────
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

// ── Config ───────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || '0x21f7944eD2F9ae2d09C9CcF55EDa92D1956d921a').toLowerCase();
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://mainnet.base.org';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE env vars in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Args ─────────────────────────────────────────────────────────
function parseArgs() {
  const out = { apply: false, wallet: null };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--apply') out.apply = true;
    if (a === '--wallet' && process.argv[i + 1]) out.wallet = process.argv[++i].toLowerCase();
  }
  return out;
}

const args = parseArgs();
console.log(`Mode: ${args.apply ? 'APPLY (will update DB)' : 'DRY-RUN (preview only)'}`);
console.log(`RPC: ${RPC_URL}`);
console.log(`Contract: ${CONTRACT_ADDRESS}`);
console.log('');

// ── Helpers ──────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Calculate total taps bought from deposit data.
 * $3 deposit = 2000 taps, $10 deposit = 7000 taps.
 * Formula: 5000 * ((total_usd - 3 * count) / 7) + 2000 * count
 */
function calcTapsBought(totalUsd, depositCount) {
  if (!depositCount || depositCount <= 0) return 0;
  const x = (totalUsd - 3 * depositCount) / 7; // number of $10 deposits
  return Math.round(5000 * x + 2000 * depositCount);
}

/**
 * Get nonce (transaction count) for an address via RPC.
 * Nonce = total outgoing transactions ever sent from this address.
 */
async function getNonce(address) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getTransactionCount',
          params: [address, 'latest'],
          id: 1,
        }),
      });
      const data = await res.json();
      if (data.result) {
        return parseInt(data.result, 16);
      }
      console.warn(`  RPC returned no result for ${address}:`, data);
      return -1;
    } catch (err) {
      console.warn(`  RPC error (attempt ${attempt + 1}/3):`, err.message);
      await sleep(2000);
    }
  }
  return -1;
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  // 1. Load users with deposits
  let query = supabase
    .from('users')
    .select('main_wallet, total_deposit_usd, deposit_count, taps_remaining, boost_percent, total_points, premium_points, standard_points')
    .gt('total_deposit_usd', 0)
    .order('total_deposit_usd', { ascending: false });

  if (args.wallet) {
    query = query.eq('main_wallet', args.wallet);
  }

  const { data: users, error: usersErr } = await query;
  if (usersErr) {
    console.error('Failed to load users:', usersErr);
    process.exit(1);
  }

  console.log(`Found ${users.length} users with deposits\n`);

  // 2. Load burner wallets
  const { data: burners, error: burnersErr } = await supabase
    .from('burner_keys')
    .select('main_wallet, burner_wallet');

  if (burnersErr) {
    console.error('Failed to load burners:', burnersErr);
    process.exit(1);
  }

  // Map: main_wallet -> burner_wallet
  const burnerMap = new Map();
  for (const b of burners) {
    burnerMap.set(b.main_wallet.toLowerCase(), b.burner_wallet.toLowerCase());
  }

  // 3. Process each user
  const results = [];
  let processed = 0;
  let skipped = 0;

  for (const user of users) {
    processed++;
    const wallet = user.main_wallet.toLowerCase();
    const burner = burnerMap.get(wallet);

    if (!burner) {
      console.log(`[${processed}/${users.length}] ${wallet} — no burner found, skipping`);
      skipped++;
      continue;
    }

    // Skip if burner === main (broken registration)
    if (burner === wallet) {
      console.log(`[${processed}/${users.length}] ${wallet} — burner === main (broken reg), skipping`);
      skipped++;
      continue;
    }

    const totalUsd = Number(user.total_deposit_usd) || 0;
    const depositCount = Number(user.deposit_count) || 0;
    const boost = Number(user.boost_percent) || 0;
    const oldPoints = Number(user.total_points) || 0;
    const oldTapsRemaining = Number(user.taps_remaining) || 0;

    const tapsBought = calcTapsBought(totalUsd, depositCount);

    // Query RPC for nonce
    console.log(`[${processed}/${users.length}] ${wallet} — burner: ${burner.slice(0, 12)}... querying nonce...`);
    const nonce = await getNonce(burner);

    if (nonce < 0) {
      console.log(`  RPC query failed — skipping`);
      skipped++;
      continue;
    }

    // Calculate
    const realTapsDone = Math.min(nonce, tapsBought);
    const newTapsRemaining = Math.max(0, tapsBought - nonce);
    const newPoints = Math.round(realTapsDone * (1 + boost / 100) * 100) / 100;
    const pointsDelta = newPoints - oldPoints;

    const entry = {
      wallet,
      burner,
      totalUsd,
      depositCount,
      tapsBought,
      nonce,
      realTapsDone,
      boost,
      newPoints,
      oldPoints,
      pointsDelta,
      oldTapsRemaining,
      newTapsRemaining,
    };
    results.push(entry);

    const flag = nonce > tapsBought ? ' *** OVER-TAPPED' : '';
    console.log(`  deposit: $${totalUsd} (${depositCount}x) => ${tapsBought} taps bought`);
    console.log(`  burner nonce: ${nonce} | real taps done: ${realTapsDone}${flag}`);
    console.log(`  boost: ${boost}% | old pts: ${oldPoints} => new pts: ${newPoints} (${pointsDelta >= 0 ? '+' : ''}${pointsDelta.toFixed(2)})`);
    console.log(`  taps_remaining: ${oldTapsRemaining} => ${newTapsRemaining}`);
    console.log('');
  }

  // 4. Summary
  console.log('===============================================');
  console.log(`SUMMARY: ${results.length} users to update (${skipped} skipped)`);
  console.log('===============================================');

  let totalOld = 0, totalNew = 0;
  for (const r of results) {
    totalOld += r.oldPoints;
    totalNew += r.newPoints;
  }
  console.log(`Total old points: ${totalOld.toFixed(2)}`);
  console.log(`Total new points: ${totalNew.toFixed(2)}`);
  console.log(`Delta: ${(totalNew - totalOld).toFixed(2)}`);
  console.log('');

  // Show users who had more nonce than taps bought (the bug victims)
  const overTapped = results.filter(r => r.nonce > r.tapsBought);
  if (overTapped.length > 0) {
    console.log(`Users with more txs than taps bought (bug victims): ${overTapped.length}`);
    for (const r of overTapped) {
      console.log(`  ${r.wallet}: nonce ${r.nonce} > ${r.tapsBought} bought (excess: ${r.nonce - r.tapsBought})`);
    }
    console.log('');
  }

  // 5. Apply if --apply
  if (!args.apply) {
    console.log('DRY-RUN complete. Run with --apply to update the database.');
    return;
  }

  console.log('APPLYING updates to Supabase...');
  let updated = 0;
  let errors = 0;

  for (const r of results) {
    const { error } = await supabase
      .from('users')
      .update({
        premium_points: r.newPoints,
        standard_points: 0,
        taps_remaining: r.newTapsRemaining,
      })
      .eq('main_wallet', r.wallet);

    if (error) {
      console.error(`  Failed to update ${r.wallet}:`, error.message);
      errors++;
    } else {
      updated++;
    }
  }

  console.log(`\nDone: ${updated} updated, ${errors} errors.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
