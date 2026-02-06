type HeadersLike =
  | Headers
  | {
      get(name: string): string | null;
    }
  | Record<string, string | null | undefined>;

function getHeader(headers: HeadersLike, name: string): string | null {
  if (!headers) return null;

  // Native Headers
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name);
  }

  // Record
  const rec = headers as Record<string, string | null | undefined>;
  const lower = name.toLowerCase();
  return rec[name] ?? rec[lower] ?? null;
}

function parseCsvEnv(value: string | undefined | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export type BaseAppDetectResult = {
  isBaseApp: boolean;
  baseAppBonusPercent: number;
  userAgent: string;
  matchedHint: string | null;
  clientHint: string | null;
};

/**
 * Best-effort detection of Base App (Coinbase Wallet) in-app browser.
 *
 * We intentionally keep this heuristic simple + configurable:
 * - Primary signal: mobile User-Agent contains one of UA hints.
 * - Secondary signal: explicit client hint header from frontend (x-basion-client=base-app),
 *   still gated by "mobile" UA to avoid enabling bonus on desktop.
 *
 * Env:
 * - BASE_APP_BONUS_PERCENT (default 30)
 * - BASE_APP_UA_HINTS (default: coinbasewallet,coinbase wallet,cbwallet,cbw,baseapp)
 */
export function detectBaseApp(headers: HeadersLike): BaseAppDetectResult {
  const bonusRaw = Number(process.env.BASE_APP_BONUS_PERCENT ?? '30');
  const baseAppBonusPercent = clampInt(bonusRaw, 0, 100);

  const ua = (getHeader(headers, 'user-agent') ?? '').toString();
  const uaLower = ua.toLowerCase();
  const secChUaMobile = (getHeader(headers, 'sec-ch-ua-mobile') ?? '').toString().trim();
  const isMobile = /iphone|ipad|ipod|android|mobile/.test(uaLower) || secChUaMobile === '?1';
  const isDesktopUA = /windows nt|macintosh|x11;.*linux x86_64|cros/.test(uaLower);

  const clientHint = (getHeader(headers, 'x-basion-client') ?? '').toString().trim().toLowerCase() || null;
  const isExplicitBaseApp = clientHint === 'base-app' || clientHint === 'base_app' || clientHint === 'baseapp';

  const hints =
    parseCsvEnv(process.env.BASE_APP_UA_HINTS) ||
    ([] as string[]);
  const effectiveHints =
    hints.length > 0 ? hints : ['coinbasewallet', 'coinbase wallet', 'cbwallet', 'cbw', 'baseapp'];

  let matchedHint: string | null = null;
  for (const h of effectiveHints) {
    if (h && uaLower.includes(h)) {
      matchedHint = h;
      break;
    }
  }

  // Rules:
  // - If UA matches a known hint: require mobile.
  // - If frontend explicitly hints base-app: allow even when UA is empty/weird,
  //   but block on clearly-desktop UA to avoid enabling bonus on desktop.
  const isBaseApp =
    (isMobile && Boolean(matchedHint)) ||
    (isExplicitBaseApp && !isDesktopUA);

  return {
    isBaseApp,
    baseAppBonusPercent: isBaseApp ? baseAppBonusPercent : 0,
    userAgent: ua,
    matchedHint,
    clientHint,
  };
}

export function getBaseAppBonusPercent(headers: HeadersLike): number {
  return detectBaseApp(headers).baseAppBonusPercent;
}

export function getEffectiveBoostPercent(baseBoostPercent: number, headers: HeadersLike): number {
  const base = clampInt(Number(baseBoostPercent) || 0, 0, 1000);
  const bonus = getBaseAppBonusPercent(headers);
  return base + bonus;
}

