import { RPC_URL, MAX_GAS_GWEI } from '@/config/constants';

// Cache for gas price (5 second TTL)
let cachedGasPrice: { value: number; timestamp: number } | null = null;
const CACHE_TTL = 5000; // 5 seconds

/**
 * Get current gas price from Base RPC (in gwei)
 * Results are cached for 5 seconds to avoid excessive RPC calls
 */
export async function getGasPrice(): Promise<number> {
  // Return cached value if still valid
  if (cachedGasPrice && Date.now() - cachedGasPrice.timestamp < CACHE_TTL) {
    return cachedGasPrice.value;
  }

  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_gasPrice',
        params: [],
        id: 1,
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC request failed: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || 'RPC error');
    }

    // Convert hex wei to gwei (1 gwei = 10^9 wei)
    const gasPriceWei = BigInt(data.result);
    const gasPriceGwei = Number(gasPriceWei) / 1e9;

    // Update cache
    cachedGasPrice = {
      value: gasPriceGwei,
      timestamp: Date.now(),
    };

    return gasPriceGwei;
  } catch (error) {
    console.error('Failed to fetch gas price:', error);
    // On error, return 0 to allow taps (fail open)
    return 0;
  }
}

/**
 * Check if current gas price is too high for tapping
 * Returns true if gas > MAX_GAS_GWEI (0.005 gwei)
 */
export async function isGasTooHigh(): Promise<boolean> {
  const gasGwei = await getGasPrice();
  return gasGwei > MAX_GAS_GWEI;
}

/**
 * Get gas price for display (if needed in future)
 */
export async function getGasPriceFormatted(): Promise<string> {
  const gasGwei = await getGasPrice();
  return `${gasGwei.toFixed(6)} gwei`;
}
