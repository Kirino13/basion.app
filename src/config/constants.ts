// BasionV2 Proxy Contract Address (UUPS Upgradeable)
export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || '0x6bdd40883a4828DfFcE33C3A2222a0eFd31DFe1A') as `0x${string}`;
export const TREASURY_ADDRESS = (process.env.NEXT_PUBLIC_TREASURY_ADDRESS || '0x52a3435A247a42B37B7f35756fBB972455f0C645') as `0x${string}`;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://sepolia.base.org';
export const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '84532');
export const ADMIN_WALLET = (process.env.NEXT_PUBLIC_ADMIN_WALLET || '0x52a3435A247a42B37B7f35756fBB972455f0C645').toLowerCase();

export const GAME_CONFIG = {
  // Package IDs match contract array indices (0 and 1)
  packages: {
    0: { usd: 3, taps: 5000, priceWei: '0.001' },   // packageId 0
    1: { usd: 10, taps: 20000, priceWei: '0.003' }, // packageId 1
  },
  treasuryPercent: 30,
  burnerPercent: 70,
  maxTapsPerSecond: 1,
  tapCooldownMs: 1000,
  referral: {
    bonusPercent: 10,        // 10% tap bonus for referrer
    referrerMultiplier: 110, // 1.1x points for referrer
    referredMultiplier: 100, // 1.0x for referred (configurable)
  },
};

// Burner wallet localStorage keys (per-wallet storage)
export const STORAGE_KEYS = {
  burnerKey: 'basion_burner_key',
  burnerAddress: 'basion_burner_address',
  referrer: 'basion_referrer',
};
