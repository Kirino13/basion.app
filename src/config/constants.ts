// BasionV2 Proxy Contract Address (UUPS Upgradeable) - Base Mainnet
export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || '0x21f7944eD2F9ae2d09C9CcF55EDa92D1956d921a') as `0x${string}`;
export const TREASURY_ADDRESS = (process.env.NEXT_PUBLIC_TREASURY_ADDRESS || '0x52a3435A247a42B37B7f35756fBB972455f0C645') as `0x${string}`;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://mainnet.base.org';
export const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '8453');
export const ADMIN_WALLET = (process.env.NEXT_PUBLIC_ADMIN_WALLET || '0x52a3435A247a42B37B7f35756fBB972455f0C645').toLowerCase();

export const GAME_CONFIG = {
  // Package IDs match contract array indices (0 and 1)
  packages: {
    0: { usd: 3, taps: 2000, priceEth: '0.001' },   // packageId 0 - $3 = 2000 taps
    1: { usd: 10, taps: 7000, priceEth: '0.003' },  // packageId 1 - $10 = 7000 taps
  },
  treasuryPercent: 30,
  burnerPercent: 70,
  maxTapsPerSecond: 0.5,
  tapCooldownMs: 2000,
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

// Commission configuration - read from env var or use defaults
// Format: "0xWallet1,0xWallet2,..." 
const DEFAULT_COMMISSION_WALLETS = [
  '0x7cf0E9B33800E21fD69Aa3Fe693B735A121AA950',
  '0x338388413cb284B31122B84da5E330017A8692C0',
  '0x5f878c7D5F4B25F5730A703a65d1492bc2b16cfB',
  '0x953e94EEf0740b77E230EEd5849432E2C9e4b2B2',
  '0x174f44A473Bb7aDfe005157abc8EAc27Bf3575f3',
  '0x8dD04af9be247A87438da2812C555C3c0F4df8d7',
  '0x882ABb7ab668188De2F80A02c958C3f88f5B0db4',
  '0xceF725dB47160438787b6ED362162DafCA6677cd',
  '0x8d1eE41E1AC330C96E36f272Cc1bE3572fB30c97',
  '0xbc189B1BC53adC93c6019DD03feccf4311D0175a',
];

export const COMMISSION_WALLETS: string[] = process.env.COMMISSION_WALLETS 
  ? process.env.COMMISSION_WALLETS.split(',').map(w => w.trim())
  : DEFAULT_COMMISSION_WALLETS;

export const COMMISSION_PERCENT = parseFloat(process.env.COMMISSION_PERCENT || '0.1');
