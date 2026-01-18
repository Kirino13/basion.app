export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || '0xeEaDb515f5bE8dB094053FFD7FC97C35d12a2c83') as `0x${string}`;
export const TREASURY_ADDRESS = (process.env.NEXT_PUBLIC_TREASURY_ADDRESS || '0x52a3435A247a42B37B7f35756fBB972455f0C645') as `0x${string}`;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://sepolia.base.org';
export const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '84532');
export const ADMIN_WALLET = (process.env.ADMIN_WALLET || '0x52a3435A247a42B37B7f35756fBB972455f0C645').toLowerCase();

export const GAME_CONFIG = {
  packages: {
    1: { usd: 3, taps: 5000 },
    2: { usd: 10, taps: 20000 },
  },
  treasuryPercent: 30,
  maxTapsPerSecond: 2,
  tapCooldownMs: 500,
  referral: {
    activationThreshold: 1000,
    bonusRate: 10,
  },
};

// Burner wallet localStorage keys
export const STORAGE_KEYS = {
  burnerKey: 'basion_burner_key',
  burnerAddress: 'basion_burner_address',
  referrer: 'basion_referrer',
};
