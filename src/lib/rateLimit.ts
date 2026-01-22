import { Ratelimit } from '@upstash/ratelimit';
import { redis, isRedisConfigured } from './redis';

// Rate limiters for different API endpoints
// Using sliding window algorithm for smooth rate limiting

// Sync user: 30 requests per minute per wallet
export const syncUserLimiter = isRedisConfigured()
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(30, '1 m'),
      prefix: 'ratelimit:sync-user',
    })
  : null;

// Commission: 60 requests per minute per wallet
export const commissionLimiter = isRedisConfigured()
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, '1 m'),
      prefix: 'ratelimit:commission',
    })
  : null;

// Leaderboard: 60 requests per minute per IP
export const leaderboardLimiter = isRedisConfigured()
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, '1 m'),
      prefix: 'ratelimit:leaderboard',
    })
  : null;

// Get burner: 10 requests per minute per IP
export const getBurnerLimiter = isRedisConfigured()
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, '1 m'),
      prefix: 'ratelimit:get-burner',
    })
  : null;

// Register burner: 2 requests per 30 seconds per wallet (prevent spam)
export const registerBurnerLimiter = isRedisConfigured()
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(2, '30 s'),
      prefix: 'ratelimit:register-burner',
    })
  : null;

// Boost: 60 requests per minute per IP
export const boostLimiter = isRedisConfigured()
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, '1 m'),
      prefix: 'ratelimit:boost',
    })
  : null;

// Boost redeem: 10 attempts per minute per wallet
export const boostRedeemLimiter = isRedisConfigured()
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, '1 m'),
      prefix: 'ratelimit:boost-redeem',
    })
  : null;

// Referral register: 3 requests per 10 seconds per wallet
export const referralRegisterLimiter = isRedisConfigured()
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, '10 s'),
      prefix: 'ratelimit:referral-register',
    })
  : null;

// Referral claim bonus: 3 requests per 30 seconds per wallet
export const referralClaimLimiter = isRedisConfigured()
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, '30 s'),
      prefix: 'ratelimit:referral-claim',
    })
  : null;

// Helper to check rate limit and return result
export async function checkRateLimit(
  limiter: Ratelimit | null,
  identifier: string
): Promise<{ success: boolean; remaining?: number }> {
  if (!limiter) {
    // Redis not configured, allow request (fallback)
    return { success: true };
  }

  try {
    const result = await limiter.limit(identifier);
    return { 
      success: result.success, 
      remaining: result.remaining 
    };
  } catch (error) {
    console.error('Rate limit check failed:', error);
    // On error, allow request (fail open)
    return { success: true };
  }
}
