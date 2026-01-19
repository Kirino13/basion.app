export interface LeaderboardEntry {
  rank: number;
  wallet: string;
  points: number;
  isCurrentUser?: boolean;
}

export interface FloatingText {
  id: number;
  x: number;
  y: number;
  value: number;
}

export interface GameState {
  myPoints: number;
  tapCost: number;
  tapBalance: number;
}

// Updated for BasionV2 contract
export interface UserStats {
  mainWallet: string;
  burnerWallet?: string;
  tapsRemaining: number;
  premiumPoints: number;
  standardPoints: number;
  totalPoints: number;
  pointsMultiplier: number;
  referrer?: string;
  isBlacklisted: boolean;
  airdropClaimed: boolean;
}

// Contract view function returns
export interface PointsData {
  premium: bigint;
  standard: bigint;
  total: bigint;
}

export interface UserInfo {
  taps: bigint;
  multiplier: bigint;
  burner: string;
}

export interface ReferralInfo {
  referrer: string;
  isBatchMode: boolean;
}
