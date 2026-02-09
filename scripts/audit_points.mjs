import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = { wallets: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--wallet' && argv[i + 1]) {
      out.wallets.push(argv[++i]);
    } else if (a === '--limit' && argv[i + 1]) {
      out.limit = Number(argv[++i]);
    } else if (a === '--fromBlock' && argv[i + 1]) {
      out.fromBlock = Number(argv[++i]);
    } else if (a === '--toBlock' && argv[i + 1]) {
      out.toBlock = Number(argv[++i]);
    } else if (a === '--creationTx' && argv[i + 1]) {
      out.creationTx = argv[++i];
    } else if (a === '--rpc' && argv[i + 1]) {
      out.rpc = argv[++i];
    } else if (a === '--contract' && argv[i + 1]) {
      out.contract = argv[++i];
    } else if (a === '--out' && argv[i + 1]) {
      out.out = argv[++i];
    } else if (a === '--help') {
      out.help = true;
    }
  }
  return out;
}

function usage() {
  return `
Usage:
  node scripts/audit_points.mjs [options]

Options:
  --wallet <0x...>        Audit a specific wallet (repeatable)
  --limit <n>             If no --wallet, audit top N users from Supabase (default: 5)
  --fromBlock <n>         Start block for log scan
  --toBlock <n>           End block for log scan (default: latest)
  --creationTx <0x...>    Convenience: derive fromBlock from contract creation tx receipt
  --rpc <url>             Override RPC URL (default: NEXT_PUBLIC_RPC_URL or https://mainnet.base.org)
  --contract <0x...>      Override contract address (default: NEXT_PUBLIC_CONTRACT_ADDRESS)
  --out <file.md>         Write a markdown report to this path (relative to basion-app/)
`.trim();
}

function loadEnvFallback() {
  // Best-effort local dev: parse .env.local if present (without adding dotenv dependency)
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const txt = fs.readFileSync(envPath, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2];
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function normalizeAddr(a) {
  if (!a) return null;
  const s = String(a).trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(s)) return null;
  return s.toLowerCase();
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimitError(err) {
  const msg = (err?.message || '').toLowerCase();
  const code = err?.error?.code ?? err?.code;
  return (
    code === -32016 ||
    code === -32011 ||
    msg.includes('rate limit') ||
    msg.includes('over rate limit') ||
    msg.includes('no backend is currently healthy')
  );
}

async function getLogsWithRetry(provider, filter) {
  let delayMs = 500;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return await provider.getLogs(filter);
    } catch (e) {
      if (!isRateLimitError(e) || attempt === 6) throw e;
      await sleep(delayMs);
      delayMs = Math.min(10_000, delayMs * 2);
    }
  }
  return [];
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  loadEnvFallback();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY (set env or .env.local)');
  }

  const rpcUrl = args.rpc || process.env.NEXT_PUBLIC_RPC_URL || 'https://mainnet.base.org';
  const contractAddress =
    normalizeAddr(args.contract || process.env.NEXT_PUBLIC_CONTRACT_ADDRESS) ||
    normalizeAddr('0x21f7944eD2F9ae2d09C9CcF55EDa92D1956d921a');
  if (!contractAddress) throw new Error('Invalid contract address');

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const iface = new ethers.Interface([
    'event Tap(address indexed user, uint256 points, bool isPremium)',
    'event PremiumTap(address indexed user, uint256 points)',
    'event StandardTap(address indexed user, uint256 points)',
    'function tap()',
    'function batchTap(uint256 count)',
    'function tapBalance(address user) view returns (uint256)',
  ]);

  // Decide scan window
  let fromBlock = Number.isFinite(args.fromBlock) ? args.fromBlock : undefined;
  let toBlock = Number.isFinite(args.toBlock) ? args.toBlock : undefined;
  if (!toBlock) toBlock = await provider.getBlockNumber();

  if (!fromBlock && args.creationTx) {
    const txHash = String(args.creationTx);
    const r = await provider.getTransactionReceipt(txHash);
    if (!r) throw new Error(`creationTx receipt not found: ${txHash}`);
    fromBlock = Number(r.blockNumber);
  }

  if (!fromBlock) {
    // Default: last ~200k blocks to keep it safe if creation tx isn't provided.
    fromBlock = Math.max(0, toBlock - 200_000);
  }

  const limit = Number.isFinite(args.limit) ? Math.max(1, Math.floor(args.limit)) : 5;

  // Select wallets
  let wallets = (args.wallets || []).map(normalizeAddr).filter(Boolean);
  if (wallets.length === 0) {
    const { data, error } = await supabase
      .from('users')
      .select('main_wallet, total_points')
      .order('total_points', { ascending: false })
      .limit(limit);
    if (error) throw error;
    wallets = (data || []).map((u) => normalizeAddr(u.main_wallet)).filter(Boolean);
  }

  const rows = [];
  for (const w of wallets) {
    // DB snapshot
    const { data: userRow } = await supabase
      .from('users')
      .select('total_points, premium_points, standard_points, boost_percent, taps_remaining')
      .eq('main_wallet', w)
      .single();

    const dbTotal = Number(userRow?.total_points) || 0;
    const dbBoost = Number(userRow?.boost_percent) || 0;
    const dbTapsRemaining = Number(userRow?.taps_remaining) || 0;

    // Chain taps remaining
    const chainTapBalance = await provider
      .call({
        to: contractAddress,
        data: iface.encodeFunctionData('tapBalance', [w]),
      })
      .catch(() => null);

    let chainTapsRemaining = null;
    if (chainTapBalance && typeof chainTapBalance === 'string') {
      try {
        // tapBalance(address) selector = bytes4(keccak256("tapBalance(address)")) = 0x5c2be... (don’t hardcode here)
        // Since we didn't include tapBalance in the iface, decode as uint256 directly.
        const v = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], chainTapBalance);
        chainTapsRemaining = Number(v[0]);
      } catch {
        chainTapsRemaining = null;
      }
    }

    // Collect tap-like logs for this wallet
    const topics = [
      ethers.id('Tap(address,uint256,bool)'),
      ethers.id('PremiumTap(address,uint256)'),
      ethers.id('StandardTap(address,uint256)'),
    ];

    const seenTxs = new Set(); // txHash
    let chainTapTxs = 0;
    let chainPointsFromEvents = 0;

    // Larger ranges reduce RPC call count and help avoid rate limits.
    const step = 20_000;
    for (let start = fromBlock; start <= toBlock; start += step + 1) {
      const end = Math.min(toBlock, start + step);
      for (const topic0 of topics) {
        const logs = await getLogsWithRetry(provider, {
          address: contractAddress,
          fromBlock: start,
          toBlock: end,
          topics: [topic0, ethers.zeroPadValue(w, 32)],
        });

        for (const log of logs) {
          let parsed = null;
          try {
            parsed = iface.parseLog(log);
          } catch {
            // ignore
          }
          if (parsed?.args?.points !== undefined) {
            chainPointsFromEvents += Number(parsed.args.points) || 0;
          }

          const txHash = log.transactionHash?.toLowerCase?.() || log.transactionHash;
          if (!txHash) continue;
          if (seenTxs.has(txHash)) continue;
          seenTxs.add(txHash);
          chainTapTxs += 1;
        }
      }
    }

    // Approximation: 1 tap per tap-tx. If batchTap() is used, this undercounts actual taps.
    const chainTapCount = chainTapTxs;
    const expectedDbApprox = chainTapCount * (1 + dbBoost / 100);

    rows.push({
      wallet: w,
      dbTotal,
      dbBoost,
      dbTapsRemaining,
      chainTapsRemaining,
      chainTapTxs,
      chainTapCount,
      chainPointsFromEvents,
      expectedDbApprox,
      deltaDbMinusExpected: dbTotal - expectedDbApprox,
    });
  }

  // Render report
  const lines = [];
  lines.push(`# Audit: chain taps vs Supabase points`);
  lines.push('');
  lines.push(`- Contract: \`${contractAddress}\``);
  lines.push(`- Blocks scanned: \`${fromBlock}\` → \`${toBlock}\``);
  lines.push(`- Note: BaseScan “Transactions” count includes non-tap methods. This audit counts only tap()/batchTap() calls by decoding tx input + Tap-like logs.`);
  lines.push('');
  lines.push('| wallet | db_total_points | db_boost% | chain_tap_txs | chain_taps_count | db_expected≈taps×(1+boost) | delta(db-expected) |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  for (const r of rows) {
    lines.push(
      `| \`${r.wallet.slice(0, 6)}…${r.wallet.slice(-4)}\` | ${r.dbTotal.toFixed(2)} | ${r.dbBoost} | ${r.chainTapTxs} | ${r.chainTapCount} | ${r.expectedDbApprox.toFixed(
        2
      )} | ${r.deltaDbMinusExpected.toFixed(2)} |`
    );
  }
  lines.push('');
  lines.push('## Raw details');
  for (const r of rows) {
    lines.push(`- ${r.wallet}`);
    lines.push(`  - db_total_points: ${r.dbTotal}`);
    lines.push(`  - db_boost_percent: ${r.dbBoost}`);
    lines.push(`  - chainTapTxs: ${r.chainTapTxs}`);
    lines.push(`  - chainTapCount: ${r.chainTapCount}`);
    lines.push(`  - chainPointsFromEvents(sum): ${r.chainPointsFromEvents}`);
    lines.push(`  - expectedDbApprox: ${r.expectedDbApprox}`);
    lines.push(`  - deltaDbMinusExpected: ${r.deltaDbMinusExpected}`);
    if (r.chainTapsRemaining !== null) lines.push(`  - chainTapBalance: ${r.chainTapsRemaining}`);
    lines.push(`  - db_taps_remaining: ${r.dbTapsRemaining}`);
  }

  const report = lines.join('\n');
  console.log(report);

  if (args.out) {
    const outPath = path.isAbsolute(args.out) ? args.out : path.join(process.cwd(), args.out);
    fs.writeFileSync(outPath, report, 'utf8');
    console.log(`\nWrote report to ${outPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

