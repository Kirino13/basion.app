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

export interface UserStats {
  mainWallet: string;
  burnerWallet?: string;
  tapsRemaining: number;
  points: number;
  totalTaps: number;
  referrer?: string;
  referralActive: boolean;
  referralBonus: number;
  referralCount: number;
}

export interface GameStats {
  tapBalance: bigint;
  points: bigint;
  totalTaps: bigint;
  burner: string;
}

export interface ReferralStats {
  referrer: string;
  isActive: boolean;
  bonus: bigint;
  count: bigint;
}
