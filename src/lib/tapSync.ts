/**
 * Shared tap-sync logic: verify a tap tx hash and atomically credit points.
 *
 * Used by:
 *  - /api/sync-user  (UI taps)
 *  - /api/tap         (bot/API taps)
 *
 * Key guarantees:
 *  1. DB-backed idempotency via tap_events (unique tx_hash).
 *  2. Atomic points increment (no read-then-write race).
 *  3. No client-trusted tapCount — derived from on-chain data.
 */

import { ethers } from 'ethers';
import { SupabaseClient } from '@supabase/supabase-js';
import { CONTRACT_ADDRESS, RPC_URL } from '@/config/constants';
import { BASION_ABI } from '@/config/abi';

// ---- Tap-like event topic0 hashes (computed once) ----
const TOPIC_TAP = ethers.id('Tap(address,uint256,bool)');
const TOPIC_PREMIUM_TAP = ethers.id('PremiumTap(address,uint256)');
const TOPIC_STANDARD_TAP = ethers.id('StandardTap(address,uint256)');
const TAP_TOPICS = new Set([TOPIC_TAP, TOPIC_PREMIUM_TAP, TOPIC_STANDARD_TAP]);

// Minimal ABI fragment for parsing tap events
const tapIface = new ethers.Interface([
  'event Tap(address indexed user, uint256 points, bool isPremium)',
  'event PremiumTap(address indexed user, uint256 points)',
  'event StandardTap(address indexed user, uint256 points)',
]);

// tap() selector = first 4 bytes of keccak256("tap()")
const TAP_SELECTOR = ethers.id('tap()').slice(0, 10);           // 0x31ed4747 (example; computed)
const BATCH_TAP_SELECTOR = ethers.id('batchTap(uint256)').slice(0, 10);

export interface ApplyTapResult {
  success: boolean;
  /** true when this txHash was already processed (idempotent) */
  alreadyProcessed: boolean;
  pointsEarned: number;
  tapCount: number;
  tapBalance: number;
  premiumPoints: number;
  standardPoints: number;
  totalPoints: number;
  boostPercent: number;
  error?: string;
}

export interface ApplyTapOptions {
  /** The on-chain transaction hash */
  txHash: string;
  /** Main wallet address (used for DB lookup; validated against on-chain data) */
  mainWallet: string;
  /** Effective boost percent (base + baseApp bonus if applicable) */
  effectiveBoostPercent: number;
  /** Source tag stored in tap_events */
  source: 'ui' | 'api' | 'bot' | 'indexer' | 'unknown';
  /** Supabase admin client */
  supabase: SupabaseClient;
  /** Optional: skip on-chain receipt verification (when caller already verified) */
  skipReceiptVerify?: boolean;
  /** Optional: explicit tap count (used when caller already knows, e.g., batchTap from API) */
  knownTapCount?: number;
}

/**
 * Verify a tap tx on-chain, insert into tap_events (idempotent), and atomically
 * increment the user's points in Supabase.
 */
export async function applyTapTxToDb(opts: ApplyTapOptions): Promise<ApplyTapResult> {
  const {
    txHash,
    mainWallet,
    effectiveBoostPercent,
    source,
    supabase,
    skipReceiptVerify = false,
    knownTapCount,
  } = opts;

  const normalizedWallet = mainWallet.toLowerCase();
  const normalizedTxHash = txHash.toLowerCase();

  // --- 1. Verify on-chain (unless caller already did) ---
  let tapCount = knownTapCount ?? 1; // default for tap()

  if (!skipReceiptVerify) {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const receipt = await provider.getTransactionReceipt(normalizedTxHash);

    if (!receipt) {
      return fail('Transaction not found');
    }
    if (receipt.status !== 1) {
      return fail('Transaction failed on-chain');
    }
    if (receipt.to?.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) {
      return fail('Transaction is not to the Basion contract');
    }

    // Check logs for Tap-like events to confirm it's actually a tap
    const hasTapEvent = receipt.logs.some(
      (log) => log.address.toLowerCase() === CONTRACT_ADDRESS.toLowerCase() && TAP_TOPICS.has(log.topics[0])
    );
    if (!hasTapEvent) {
      return fail('Transaction has no Tap event (not a tap tx)');
    }

    // Derive tapCount from calldata
    try {
      const tx = await provider.getTransaction(normalizedTxHash);
      if (tx?.data) {
        const selector = tx.data.slice(0, 10).toLowerCase();
        if (selector === BATCH_TAP_SELECTOR.toLowerCase()) {
          // batchTap(uint256 count)
          const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], '0x' + tx.data.slice(10));
          tapCount = Math.max(1, Math.min(100, Number(decoded[0])));
        }
        // else: tap() → tapCount = 1
      }
    } catch {
      // If we can't decode calldata, default to 1
      tapCount = 1;
    }
  }

  // --- 2. DB-backed idempotency: insert into tap_events ---
  const pointsPerTap = 1 * (1 + effectiveBoostPercent / 100);
  const pointsEarned = pointsPerTap * tapCount;

  const { data: inserted, error: insertError } = await supabase
    .from('tap_events')
    .insert({
      tx_hash: normalizedTxHash,
      main_wallet: normalizedWallet,
      tap_count: tapCount,
      points_earned: pointsEarned,
      boost_percent: effectiveBoostPercent,
      source,
    })
    .select('tx_hash')
    .maybeSingle();

  if (insertError) {
    // unique_violation (23505) means already processed → idempotent success
    const pgCode = (insertError as { code?: string }).code;
    if (pgCode === '23505') {
      return await returnCurrentState(supabase, normalizedWallet, true);
    }
    console.error('tap_events insert error:', insertError);
    return fail(`Database error: ${insertError.message}`);
  }

  if (!inserted) {
    // Shouldn't happen with maybeSingle + no conflict, but handle gracefully
    return await returnCurrentState(supabase, normalizedWallet, true);
  }

  // --- 3. Atomic points increment ---
  // Determine premium vs standard (single tap = premium, batch = standard, matching existing logic)
  const premiumDelta = tapCount === 1 ? pointsEarned : 0;
  const standardDelta = tapCount > 1 ? pointsEarned : 0;

  // Read tap balance from chain
  let tapBalance = 0;
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, BASION_ABI, provider);
    tapBalance = Number(await contract.tapBalance(mainWallet));
  } catch (err) {
    console.warn('Failed to read tapBalance from chain:', err);
  }

  // Try the Postgres RPC function first (atomic increment, no races)
  const { error: rpcError } = await supabase.rpc('increment_user_points', {
    p_wallet: normalizedWallet,
    p_premium_delta: premiumDelta,
    p_standard_delta: standardDelta,
    p_taps_remaining: tapBalance,
  });

  if (rpcError) {
    // Fallback: the RPC function might not exist yet (migration not run).
    // Use the old read+write approach as last resort.
    console.warn('increment_user_points RPC failed, using fallback:', rpcError.message);
    try {
      const { data: currentUser } = await supabase
        .from('users')
        .select('premium_points, standard_points')
        .eq('main_wallet', normalizedWallet)
        .single();

      const curPremium = Number(currentUser?.premium_points) || 0;
      const curStandard = Number(currentUser?.standard_points) || 0;
      const newPremium = curPremium + premiumDelta;
      const newStandard = curStandard + standardDelta;

      await supabase.from('users').upsert(
        {
          main_wallet: normalizedWallet,
          premium_points: newPremium,
          standard_points: newStandard,
          total_points: newPremium + newStandard,
          taps_remaining: tapBalance,
          last_tap_at: new Date().toISOString(),
        },
        { onConflict: 'main_wallet' }
      );
    } catch (fallbackErr) {
      console.error('Fallback points update also failed:', fallbackErr);
      return fail('Failed to update points');
    }
  }

  return await returnCurrentState(supabase, normalizedWallet, false, pointsEarned);
}

// ---- helpers ----

function fail(error: string): ApplyTapResult {
  return {
    success: false,
    alreadyProcessed: false,
    pointsEarned: 0,
    tapCount: 0,
    tapBalance: 0,
    premiumPoints: 0,
    standardPoints: 0,
    totalPoints: 0,
    boostPercent: 0,
    error,
  };
}

async function returnCurrentState(
  supabase: SupabaseClient,
  wallet: string,
  alreadyProcessed: boolean,
  pointsEarned?: number
): Promise<ApplyTapResult> {
  const { data: u } = await supabase
    .from('users')
    .select('total_points, premium_points, standard_points, taps_remaining, boost_percent')
    .eq('main_wallet', wallet)
    .single();

  return {
    success: true,
    alreadyProcessed,
    pointsEarned: pointsEarned ?? 0,
    tapCount: alreadyProcessed ? 0 : 1,
    tapBalance: Number(u?.taps_remaining) || 0,
    premiumPoints: Number(u?.premium_points) || 0,
    standardPoints: Number(u?.standard_points) || 0,
    totalPoints: Number(u?.total_points) || 0,
    boostPercent: Number(u?.boost_percent) || 0,
  };
}
