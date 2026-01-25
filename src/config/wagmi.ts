import { http, createConfig } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { injected, coinbaseWallet } from 'wagmi/connectors';
import { RPC_URL, CHAIN_ID } from './constants';

// Determine which chain to use based on CHAIN_ID env var
// 8453 = Base Mainnet, 84532 = Base Sepolia
const isMainnet = CHAIN_ID === 8453;
const activeChain = isMainnet ? base : baseSepolia;

export const config = createConfig({
  chains: [activeChain],
  connectors: [
    injected(),
    coinbaseWallet({ appName: 'Basion.app' }),
  ],
  transports: {
    [activeChain.id]: http(RPC_URL),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
