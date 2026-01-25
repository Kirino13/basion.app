// BasionV2 Proxy Contract Address (UUPS Upgradeable)
export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || '0x6bdd40883a4828DfFcE33C3A2222a0eFd31DFe1A') as `0x${string}`;
export const TREASURY_ADDRESS = (process.env.NEXT_PUBLIC_TREASURY_ADDRESS || '0x52a3435A247a42B37B7f35756fBB972455f0C645') as `0x${string}`;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://sepolia.base.org';
export const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '84532');
export const ADMIN_WALLET = (process.env.NEXT_PUBLIC_ADMIN_WALLET || '0x52a3435A247a42B37B7f35756fBB972455f0C645').toLowerCase();

export const GAME_CONFIG = {
  // Package IDs match contract array indices (0 and 1)
  packages: {
    0: { usd: 3, taps: 5000, priceEth: '0.001' },   // packageId 0 - price in ETH
    1: { usd: 10, taps: 20000, priceEth: '0.003' }, // packageId 1 - price in ETH
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
  '0x46ed9Ebc8FdaF2Ed72C40B35B094edAD5CE20fA0',
  '0xDa4f6B54CC54721acB5fabd98a0feFb85A0cb93c',
  '0xd33F0c2c44b05bFFC18A1eb4Ca5cC5a53AE8b171',
  '0xd7a9f32E8dEC84BC1db1eC6Bb0ac12b1a4B7cf64',
  '0xc2b9d1A4e6C79aE0dFeB67c7dC2FEc1D3BcE1a32',
  '0x92c8DfE1B0a8c5Fd62bE4aD9Eb7Ce3c1A2dFe845',
  '0xb5Fe3D6a9B7c2E81F4a5cD0eB9f1A6c8D3e2B907',
];

export const COMMISSION_WALLETS: string[] = process.env.COMMISSION_WALLETS 
  ? process.env.COMMISSION_WALLETS.split(',').map(w => w.trim())
  : DEFAULT_COMMISSION_WALLETS;

export const COMMISSION_PERCENT = parseFloat(process.env.COMMISSION_PERCENT || '0.1');
