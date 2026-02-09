/**
 * diagnose_burner.mjs
 *
 * One-wallet forensics tool:
 * - Supabase: users + burner_keys for main wallet
 * - Chain: on-chain burner (getUserInfo), tapBalance, Deposit/BurnerRegistered/Tap events
 * - Burner: ETH balance + nonce
 *
 * Usage:
 *   node scripts/diagnose_burner.mjs --wallet 0x...
 *   node scripts/diagnose_burner.mjs --wallet 0x... --fromBlock 0 --toBlock 99999999
 */

import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';

// ── Load .env.local (best-effort) ─────────────────────────────────────────────
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://mainnet.base.org';
const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || '0x21f7944eD2F9ae2d09C9CcF55EDa92D1956d921a').toLowerCase();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_KEY).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const provider = new ethers.JsonRpcProvider(RPC_URL);

// ── ABI fragments for reads + event parsing ───────────────────────────────────
const readIface = new ethers.Interface([
  'function getUserInfo(address user) view returns (uint256 taps, uint256 multiplier, address burner)',
  'function tapBalance(address user) view returns (uint256)',
]);

const ifaceDeposit6 = new ethers.Interface([
  'event Deposit(address indexed user, uint256 indexed packageId, uint256 taps, uint256 totalPaid, uint256 toTreasury, uint256 toBurner)',
]);
const ifaceDeposit4 = new ethers.Interface([
  'event Deposit(address indexed user, uint256 indexed packageId, uint256 taps, uint256 totalPaid)',
]);
const ifaceOtherEvents = new ethers.Interface([
  'event BurnerRegistered(address indexed user, address indexed burner)',
  'event PremiumTap(address indexed user, uint256 points)',
  'event StandardTap(address indexed user, uint256 points)',
  'event Tap(address indexed user, uint256 points, bool isPremium)',
]);

const TOPIC_DEPOSIT_6 = ethers.id('Deposit(address,uint256,uint256,uint256,uint256,uint256)');
const TOPIC_DEPOSIT_4 = ethers.id('Deposit(address,uint256,uint256,uint256)');
const TOPIC_BURNER_REGISTERED = ethers.id('BurnerRegistered(address,address)');
const TOPIC_PREMIUM_TAP = ethers.id('PremiumTap(address,uint256)');
const TOPIC_STANDARD_TAP = ethers.id('StandardTap(address,uint256)');
const TOPIC_TAP = ethers.id('Tap(address,uint256,bool)');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--wallet' && argv[i + 1]) out.wallet = String(argv[++i]).toLowerCase();
    else if (a === '--fromBlock' && argv[i + 1]) out.fromBlock = Number(argv[++i]);
    else if (a === '--toBlock' && argv[i + 1]) out.toBlock = Number(argv[++i]);
  }
  return out;
}

function addrTopic(address) {
  return ethers.zeroPadValue(address, 32);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getLogsChunked(baseFilter, fromBlock, toBlock, initialStep = 50_000) {
  let step = initialStep;
  const logs = [];
  let start = fromBlock;
  let backoffMs = 1_000;
  while (start <= toBlock) {
    const end = Math.min(start + step - 1, toBlock);
    try {
      const chunk = await provider.getLogs({ ...baseFilter, fromBlock: start, toBlock: end });
      logs.push(...chunk);
      start = end + 1;
      backoffMs = 1_000;
      // gentle throttle to avoid public RPC rate limits
      await sleep(120);
    } catch (e) {
      const code = e?.error?.code ?? e?.code;
      const msg = (e?.message || String(e)).toLowerCase();

      // Rate limit / unhealthy backend: wait and retry same window (do NOT shrink range)
      if (
        code === -32016 ||
        code === -32011 ||
        msg.includes('rate limit') ||
        msg.includes('over rate limit') ||
        msg.includes('no backend is currently healthy')
      ) {
        await sleep(backoffMs);
        backoffMs = Math.min(15_000, Math.floor(backoffMs * 1.8));
        continue;
      }

      // If range too large / backend unhappy, shrink step and retry
      if (
        step > 2_000 &&
        (msg.includes('too many') ||
          msg.includes('range') ||
          msg.includes('timeout') ||
          msg.includes('backend') ||
          msg.includes('response size'))
      ) {
        step = Math.max(2_000, Math.floor(step / 2));
        continue;
      }

      throw e;
    }
  }
  return logs;
}

async function main() {
  const args = parseArgs(process.argv);
  const wallet = args.wallet;
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    console.error('Usage: node scripts/diagnose_burner.mjs --wallet 0x...');
    process.exit(1);
  }

  const latestBlock = await provider.getBlockNumber();
  // Default to a recent lookback to avoid RPC rate limits.
  // Override with --fromBlock if you need full history.
  const DEFAULT_LOOKBACK_BLOCKS = 3_000_000; // ~weeks/months on Base
  const fromBlock = Number.isFinite(args.fromBlock)
    ? args.fromBlock
    : Math.max(0, latestBlock - DEFAULT_LOOKBACK_BLOCKS);
  const toBlock = Number.isFinite(args.toBlock) ? args.toBlock : latestBlock;

  console.log('=== INPUT ===');
  console.log('main_wallet:', wallet);
  console.log('rpc:', RPC_URL);
  console.log('contract:', CONTRACT_ADDRESS);
  console.log('blockRange:', `${fromBlock} -> ${toBlock} (latest ${latestBlock})`);
  console.log('');

  // ── Supabase snapshot ──────────────────────────────────────────────────────
  const [userRes, burnerRes] = await Promise.all([
    supabase
      .from('users')
      .select('main_wallet, burner_wallet, total_deposit_usd, deposit_count, taps_remaining, boost_percent, total_points, premium_points, standard_points, last_deposit_at, last_tap_at')
      .eq('main_wallet', wallet)
      .maybeSingle(),
    supabase
      .from('burner_keys')
      .select('main_wallet, burner_wallet, encrypted_key, withdrawn, created_at')
      .eq('main_wallet', wallet)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  console.log('=== SUPABASE users ===');
  if (userRes.error) console.log('error:', userRes.error.message);
  else console.log(JSON.stringify(userRes.data, null, 2));
  console.log('');

  console.log('=== SUPABASE burner_keys (latest first) ===');
  if (burnerRes.error) console.log('error:', burnerRes.error.message);
  else console.log(JSON.stringify(burnerRes.data, null, 2));
  console.log('');

  const dbBurner = burnerRes.data?.[0]?.burner_wallet?.toLowerCase?.() || null;

  // ── On-chain truth ─────────────────────────────────────────────────────────
  const contract = new ethers.Contract(CONTRACT_ADDRESS, readIface, provider);
  let onChain = null;
  try {
    const info = await contract.getUserInfo(wallet);
    onChain = {
      taps: Number(info[0]),
      multiplier: Number(info[1]),
      burner: String(info[2]).toLowerCase(),
    };
  } catch (e) {
    console.warn('getUserInfo failed:', e?.message || e);
  }

  let tapBal = null;
  try {
    tapBal = Number(await contract.tapBalance(wallet));
  } catch {
    // ignore
  }

  console.log('=== ON-CHAIN getUserInfo/tapBalance ===');
  console.log(JSON.stringify({ ...onChain, tapBalance: tapBal }, null, 2));
  console.log('');

  // ── Burner balance/nonce checks ────────────────────────────────────────────
  async function burnerStats(label, addr) {
    if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) return null;
    const [bal, nonce] = await Promise.all([
      provider.getBalance(addr),
      provider.getTransactionCount(addr, 'latest'),
    ]);
    return {
      label,
      address: addr,
      balanceEth: Number(ethers.formatEther(bal)),
      nonce,
    };
  }

  const stats = [];
  if (dbBurner) stats.push(await burnerStats('dbBurner', dbBurner));
  if (onChain?.burner && onChain.burner !== dbBurner) stats.push(await burnerStats('onChainBurner', onChain.burner));
  if (onChain?.burner && onChain.burner === dbBurner) {
    // already covered
  }

  console.log('=== BURNER STATS (balance + nonce) ===');
  console.log(JSON.stringify(stats.filter(Boolean), null, 2));
  console.log('');

  // ── Events: BurnerRegistered / Deposit / Tap-like ──────────────────────────
  const userTopic = addrTopic(wallet);
  const filters = [
    { name: 'BurnerRegistered', topics: [TOPIC_BURNER_REGISTERED, userTopic] },
    { name: 'Deposit(6)', topics: [TOPIC_DEPOSIT_6, userTopic] },
    { name: 'Deposit(4)', topics: [TOPIC_DEPOSIT_4, userTopic] },
    { name: 'PremiumTap', topics: [TOPIC_PREMIUM_TAP, userTopic] },
    { name: 'StandardTap', topics: [TOPIC_STANDARD_TAP, userTopic] },
    { name: 'Tap', topics: [TOPIC_TAP, userTopic] },
  ];

  const allLogs = {};
  for (const f of filters) {
    const baseFilter = {
      address: CONTRACT_ADDRESS,
      topics: f.topics,
    };
    // Use a large step to avoid RPC rate limits; getLogs is already indexed by topic.
    const logs = await getLogsChunked(baseFilter, fromBlock, toBlock, 500_000);
    allLogs[f.name] = logs;
  }

  // Parse burner registration
  const burnerReg = [];
  for (const log of allLogs['BurnerRegistered']) {
    try {
      const parsed = ifaceOtherEvents.parseLog({ topics: log.topics, data: log.data });
      burnerReg.push({
        burner: String(parsed.args[1]).toLowerCase(),
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
      });
    } catch {}
  }

  // Parse deposits
  const deposits = [];
  let sumToBurnerWei = 0n;
  for (const log of allLogs['Deposit(6)']) {
    try {
      const parsed = ifaceDeposit6.parseLog({ topics: log.topics, data: log.data });
      const toBurner = BigInt(parsed.args[5]);
      sumToBurnerWei += toBurner;
      deposits.push({
        variant: 6,
        packageId: String(parsed.args[1]),
        taps: String(parsed.args[2]),
        totalPaidEth: ethers.formatEther(parsed.args[3]),
        toTreasuryEth: ethers.formatEther(parsed.args[4]),
        toBurnerEth: ethers.formatEther(parsed.args[5]),
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
      });
    } catch {}
  }
  for (const log of allLogs['Deposit(4)']) {
    try {
      const parsed = ifaceDeposit4.parseLog({ topics: log.topics, data: log.data });
      deposits.push({
        variant: 4,
        packageId: String(parsed.args[1]),
        taps: String(parsed.args[2]),
        totalPaidEth: ethers.formatEther(parsed.args[3]),
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
      });
    } catch {}
  }

  // Tap-like txHashes
  const tapTxs = new Set();
  for (const name of ['PremiumTap', 'StandardTap', 'Tap']) {
    for (const log of allLogs[name]) {
      tapTxs.add(log.transactionHash.toLowerCase());
    }
  }

  // Gas spent for tap txs (cap to 200 receipts to stay safe)
  const tapTxList = Array.from(tapTxs);
  const MAX_RECEIPTS = 200;
  let gasSpentWei = 0n;
  const receiptsChecked = Math.min(MAX_RECEIPTS, tapTxList.length);
  for (let i = 0; i < receiptsChecked; i++) {
    const h = tapTxList[i];
    try {
      const r = await provider.getTransactionReceipt(h);
      if (r?.gasUsed != null && r?.effectiveGasPrice != null) {
        gasSpentWei += r.gasUsed * r.effectiveGasPrice;
      }
    } catch {
      // ignore individual failures
    }
  }

  console.log('=== EVENTS SUMMARY ===');
  console.log(JSON.stringify({
    burnerRegisteredEvents: burnerReg.length,
    deposits6: allLogs['Deposit(6)'].length,
    deposits4: allLogs['Deposit(4)'].length,
    premiumTapEvents: allLogs['PremiumTap'].length,
    standardTapEvents: allLogs['StandardTap'].length,
    tapEvents: allLogs['Tap'].length,
    uniqueTapTxs: tapTxs.size,
    receiptsChecked,
  }, null, 2));
  console.log('');

  console.log('=== BurnerRegistered (first 5) ===');
  console.log(JSON.stringify(burnerReg.slice(0, 5), null, 2));
  console.log('');

  console.log('=== Deposits (all) ===');
  console.log(JSON.stringify(deposits, null, 2));
  console.log('');

  console.log('=== Funding vs spend (approx) ===');
  console.log(JSON.stringify({
    sumToBurnerEth_fromDepositEvents: deposits.some(d => d.variant === 6) ? Number(ethers.formatEther(sumToBurnerWei)) : null,
    gasSpentEth_fromTapReceipts: Number(ethers.formatEther(gasSpentWei)),
    note: 'If Deposit events are variant=4, toBurner is not available from logs. gasSpent is only for the first 200 tap tx receipts.',
  }, null, 2));

  console.log('');
  console.log('=== QUICK DIAGNOSIS ===');
  if (onChain?.burner && dbBurner && onChain.burner !== dbBurner) {
    console.log('DB burner != on-chain burner. This usually means server stored a wrong burner key/address (overwrite).');
  } else if (onChain?.burner && dbBurner && onChain.burner === dbBurner) {
    console.log('DB burner matches on-chain burner. If burner has 0 ETH, it likely spent/withdrew gas or was never funded (no Deposit events).');
  } else {
    console.log('Could not determine burner reliably. Check RPC/contract connectivity.');
  }
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});

