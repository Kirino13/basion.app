// BasionV2 Contract ABI
// UUPS Upgradeable Proxy Pattern
// Deploy this, then update CONTRACT_ADDRESS in constants.ts

export const BASION_V2_ABI = [
  // ============ EVENTS ============
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "user", "type": "address" },
      { "indexed": true, "internalType": "uint256", "name": "packageId", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "taps", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "totalPaid", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "toTreasury", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "toBurner", "type": "uint256" }
    ],
    "name": "Deposit",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "user", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "burner", "type": "address" }
    ],
    "name": "BurnerRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "user", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "points", "type": "uint256" }
    ],
    "name": "PremiumTap",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "user", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "points", "type": "uint256" }
    ],
    "name": "StandardTap",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "user", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "multiplier", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "bonusTaps", "type": "uint256" }
    ],
    "name": "BoostSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "user", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "referrer", "type": "address" }
    ],
    "name": "ReferralRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "user", "type": "address" },
      { "indexed": false, "internalType": "bool", "name": "status", "type": "bool" }
    ],
    "name": "Blacklisted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [],
    "name": "BatchModeEnabled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "user", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "AirdropClaimed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "packageId", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "priceWei", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "taps", "type": "uint256" }
    ],
    "name": "PackageAdded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "packageId", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "priceWei", "type": "uint256" },
      { "indexed": false, "internalType": "uint256", "name": "taps", "type": "uint256" },
      { "indexed": false, "internalType": "bool", "name": "active", "type": "bool" }
    ],
    "name": "PackageUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "oldTreasury", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "newTreasury", "type": "address" }
    ],
    "name": "TreasuryUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "internalType": "address", "name": "account", "type": "address" }
    ],
    "name": "Paused",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "internalType": "address", "name": "account", "type": "address" }
    ],
    "name": "Unpaused",
    "type": "event"
  },

  // ============ READ FUNCTIONS ============
  
  // Get user statistics
  {
    "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
    "name": "getStats",
    "outputs": [
      { "internalType": "uint256", "name": "taps", "type": "uint256" },
      { "internalType": "uint256", "name": "premium", "type": "uint256" },
      { "internalType": "uint256", "name": "standard", "type": "uint256" },
      { "internalType": "uint256", "name": "totalPoints", "type": "uint256" },
      { "internalType": "uint256", "name": "multiplier", "type": "uint256" },
      { "internalType": "address", "name": "burner", "type": "address" },
      { "internalType": "address", "name": "ref", "type": "address" },
      { "internalType": "bool", "name": "isBatchMode", "type": "bool" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  
  // Get total points
  {
    "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
    "name": "getTotalPoints",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  
  // Calculate airdrop
  {
    "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
    "name": "calculateAirdrop",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  
  // Get package
  {
    "inputs": [{ "internalType": "uint256", "name": "packageId", "type": "uint256" }],
    "name": "getPackage",
    "outputs": [
      { "internalType": "uint256", "name": "priceWei", "type": "uint256" },
      { "internalType": "uint256", "name": "taps", "type": "uint256" },
      { "internalType": "bool", "name": "active", "type": "bool" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  
  // Can tap check
  {
    "inputs": [{ "internalType": "address", "name": "user", "type": "address" }],
    "name": "canTap",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },

  // Individual mappings
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "tapBalance",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "premiumPoints",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "standardPoints",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "userToBurner",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "burnerToUser",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "pointsMultiplier",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "referrer",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "blacklisted",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "airdropClaimed",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "name": "bonusTapsReceived",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },

  // Constants and state
  {
    "inputs": [],
    "name": "treasury",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "packageCount",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "batchMode",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "referrerBoostMultiplier",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "referredBoostMultiplier",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "referrerTapBonusPercent",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "tokenAddress",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "premiumAirdropMultiplier",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "standardAirdropMultiplier",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "TREASURY_PERCENT",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "BURNER_PERCENT",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "paused",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "version",
    "outputs": [{ "internalType": "string", "name": "", "type": "string" }],
    "stateMutability": "pure",
    "type": "function"
  },

  // ============ WRITE FUNCTIONS ============
  
  // User functions
  {
    "inputs": [{ "internalType": "address", "name": "burner", "type": "address" }],
    "name": "registerBurner",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "packageId", "type": "uint256" },
      { "internalType": "address", "name": "_referrer", "type": "address" }
    ],
    "name": "deposit",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "tap",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "count", "type": "uint256" }],
    "name": "batchTap",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "claimAirdrop",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },

  // Owner functions
  {
    "inputs": [
      { "internalType": "uint256", "name": "priceWei", "type": "uint256" },
      { "internalType": "uint256", "name": "taps", "type": "uint256" }
    ],
    "name": "addPackage",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "packageId", "type": "uint256" },
      { "internalType": "uint256", "name": "priceWei", "type": "uint256" },
      { "internalType": "uint256", "name": "taps", "type": "uint256" },
      { "internalType": "bool", "name": "active", "type": "bool" }
    ],
    "name": "updatePackage",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "user", "type": "address" },
      { "internalType": "uint256", "name": "multiplier", "type": "uint256" },
      { "internalType": "uint256", "name": "_bonusTaps", "type": "uint256" }
    ],
    "name": "setBoost",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "_referrerMultiplier", "type": "uint256" },
      { "internalType": "uint256", "name": "_referredMultiplier", "type": "uint256" }
    ],
    "name": "setReferralBoosts",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "_percent", "type": "uint256" }],
    "name": "setReferrerTapBonus",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "enableBatchMode",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "user", "type": "address" },
      { "internalType": "bool", "name": "status", "type": "bool" }
    ],
    "name": "setBlacklist",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "_treasury", "type": "address" }],
    "name": "setTreasury",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pause",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "unpause",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "withdrawStuckETH",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "_token", "type": "address" }],
    "name": "setTokenAddress",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "_premium", "type": "uint256" },
      { "internalType": "uint256", "name": "_standard", "type": "uint256" }
    ],
    "name": "setAirdropMultipliers",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },

  // UUPS
  {
    "inputs": [
      { "internalType": "address", "name": "newImplementation", "type": "address" },
      { "internalType": "bytes", "name": "data", "type": "bytes" }
    ],
    "name": "upgradeToAndCall",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },

  // Receive ETH
  {
    "stateMutability": "payable",
    "type": "receive"
  }
] as const;
