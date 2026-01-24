export async function getEthPrice(): Promise<number> {
  const response = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot');
  
  if (!response.ok) {
    throw new Error(`Failed to fetch ETH price: ${response.status}`);
  }
  
  const data = await response.json();
  
  if (!data?.data?.amount) {
    throw new Error('Invalid ETH price response format');
  }
  
  const price = parseFloat(data.data.amount);
  
  if (isNaN(price) || price <= 0) {
    throw new Error('Invalid ETH price value');
  }
  
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
