// Cache for ETH price to reduce API calls
let priceCache: { value: number; timestamp: number } | null = null;
const PRICE_CACHE_TTL = 30000; // 30 seconds

export async function getEthPrice(): Promise<number> {
  // Return cached value if still valid
  if (priceCache && Date.now() - priceCache.timestamp < PRICE_CACHE_TTL) {
    return priceCache.value;
  }

  const response = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot');
  
  if (!response.ok) {
    // If fetch failed but we have a cached value, return it
    if (priceCache) {
      console.warn('ETH price fetch failed, using cached value');
      return priceCache.value;
    }
    throw new Error(`Failed to fetch ETH price: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (!data?.data?.amount) {
    if (priceCache) return priceCache.value;
    throw new Error('Invalid ETH price response format');
  }
  
  const price = parseFloat(data.data.amount);
  
  if (isNaN(price) || price <= 0) {
    if (priceCache) return priceCache.value;
    throw new Error('Invalid ETH price value');
  }
  
  // Update cache
  priceCache = { value: price, timestamp: Date.now() };
  
  return price;
}

export function usdToEth(usdAmount: number, ethPrice: number, bufferPercent: number = 0): string {
  if (ethPrice <= 0) {
    throw new Error('Invalid ETH price');
  }
  const ethAmount = usdAmount / ethPrice;
  const withBuffer = bufferPercent > 0 ? ethAmount * (1 + bufferPercent / 100) : ethAmount;
  return withBuffer.toFixed(6);
}
