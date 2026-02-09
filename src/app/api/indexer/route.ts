import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabase';
import { CONTRACT_ADDRESS, RPC_URL } from '@/config/constants';

/**
 * GET /api/indexer
 *
 * Continuous indexer: scans new Tap events from the chain, inserts them into
 * tap_events (idempotent), and updates user points atomically.
 *
 * Designed to be called by a cron job (e.g., every 60 seconds via Vercel Cron).
 * Also supports manual invocation with ?fromBlock=<number> for backfill.
 *
 * Auth: requires INDEXER_SECRET header or env-based secret to prevent abuse.
 */

// Event topic hashes
const TOPIC_TAP = ethers.id('Tap(address,uint256,bool)');
const TOPIC_PREMIUM_TAP = ethers.id('PremiumTap(address,uint256)');
const TOPIC_STANDARD_TAP = ethers.id('StandardTap(address,uint256)');
const TAP_TOPICS = [TOPIC_TAP, TOPIC_PREMIUM_TAP, TOPIC_STANDARD_TAP];

const tapIface = new ethers.Interface([
  'event Tap(address indexed user, uint256 points, bool isPremium)',
  'event PremiumTap(address indexed user, uint256 points)',
  'event StandardTap(address indexed user, uint256 points)',
]);

// Max blocks to scan per invocation (to avoid timeouts)
const MAX_BLOCKS_PER_RUN = 50_000;
const LOG_STEP = 10_000; // blocks per eth_getLogs call

const INDEXER_SECRET = process.env.INDEXER_SECRET || '';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel function timeout

export async function GET(request: Request) {
  try {
    // Auth check
    const url = new URL(request.url);
    const secretParam = url.searchParams.get('secret') || request.headers.get('x-indexer-secret') || '';
    if (INDEXER_SECRET && secretParam !== INDEXER_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const currentBlock = await provider.getBlockNumber();

    // Determine start block
    let fromBlock: number;

    const fromBlockParam = url.searchParams.get('fromBlock');
    if (fromBlockParam) {
      fromBlock = parseInt(fromBlockParam);
    } else {
      // Get last indexed block from sync_state
      const { data: syncRow } = await supabase
        .from('sync_state')
        .select('value')
        .eq('key', 'indexer_last_block')
        .single();

      fromBlock = syncRow ? parseInt(syncRow.value) + 1 : currentBlock - 10_000; // default: last 10k blocks
    }

    const toBlock = Math.min(fromBlock + MAX_BLOCKS_PER_RUN - 1, currentBlock);

    if (fromBlock > currentBlock) {
      return NextResponse.json({
        success: true,
        message: 'Already up to date',
        currentBlock,
        lastIndexedBlock: fromBlock - 1,
      });
    }

    let totalProcessed = 0;
    let totalInserted = 0;
    let totalSkipped = 0;

    // Scan in chunks
    for (let start = fromBlock; start <= toBlock; start += LOG_STEP) {
      const end = Math.min(start + LOG_STEP - 1, toBlock);

      let logs: ethers.Log[];
      try {
        logs = await provider.getLogs({
          address: CONTRACT_ADDRESS,
          topics: [TAP_TOPICS],
          fromBlock: start,
          toBlock: end,
        });
      } catch (err) {
        console.warn(`getLogs failed for ${start}-${end}:`, err);
        // Retry with smaller chunk
        try {
          await sleep(2000);
          logs = await provider.getLogs({
            address: CONTRACT_ADDRESS,
            topics: [TAP_TOPICS],
            fromBlock: start,
            toBlock: end,
          });
        } catch (retryErr) {
          console.error(`getLogs retry failed for ${start}-${end}:`, retryErr);
          // Save progress and stop
          break;
        }
      }

      // Group events by txHash
      const txEvents = new Map<string, { wallet: string; points: number; isPremium: boolean }[]>();
      for (const log of logs) {
        try {
          const parsed = tapIface.parseLog({ topics: log.topics as string[], data: log.data });
          if (!parsed) continue;

          const txHash = log.transactionHash.toLowerCase();
          const user = (parsed.args[0] as string).toLowerCase();
          const points = Number(parsed.args[1] || 1);
          const isPremium = parsed.name === 'Tap' ? Boolean(parsed.args[2]) : parsed.name === 'PremiumTap';

          if (!txEvents.has(txHash)) {
            txEvents.set(txHash, []);
          }
          txEvents.get(txHash)!.push({ wallet: user, points, isPremium });
        } catch {
          // Skip unparseable logs
        }
      }

      // Process each tx
      for (const [txHash, events] of txEvents) {
        totalProcessed++;

        // All events in a tx should be from the same user
        const wallet = events[0].wallet;
        const totalPoints = events.reduce((sum, e) => sum + e.points, 0);
        const tapCount = events.length; // Each Tap event = 1 tap in the batch

        // Idempotent insert into tap_events
        const { error: insertError } = await supabase
          .from('tap_events')
          .insert({
            tx_hash: txHash,
            main_wallet: wallet,
            tap_count: tapCount,
            points_earned: totalPoints,
            boost_percent: 0, // We don't know the boost from chain events alone
            source: 'indexer',
          });

        if (insertError) {
          const pgCode = (insertError as { code?: string }).code;
          if (pgCode === '23505') {
            totalSkipped++; // Already processed
            continue;
          }
          console.warn('tap_events insert error:', insertError);
          continue;
        }

        totalInserted++;

        // Atomic increment user points
        // Note: chain events give integer points (no fractional boost).
        // The indexer records what the chain says; fractional boost adjustments
        // should come from the live /api/sync-user or /api/tap paths.
        const premiumDelta = tapCount === 1 ? totalPoints : 0;
        const standardDelta = tapCount > 1 ? totalPoints : 0;

        const { error: rpcError } = await supabase.rpc('increment_user_points', {
          p_wallet: wallet,
          p_premium_delta: premiumDelta,
          p_standard_delta: standardDelta,
          p_taps_remaining: 0, // Indexer doesn't update tap balance
        });

        if (rpcError) {
          console.warn('increment_user_points failed for', wallet, rpcError.message);
        }
      }

      // Save checkpoint after each chunk
      await supabase.from('sync_state').upsert(
        { key: 'indexer_last_block', value: String(end), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    }

    return NextResponse.json({
      success: true,
      fromBlock,
      toBlock,
      currentBlock,
      totalProcessed,
      totalInserted,
      totalSkipped,
    });
  } catch (error) {
    console.error('Indexer error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
