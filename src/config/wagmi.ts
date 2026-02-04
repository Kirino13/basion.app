import { http, createConfig } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { injected, coinbaseWallet, walletConnect } from 'wagmi/connectors';
import { RPC_URL, CHAIN_ID } from './constants';

// Determine which chain to use based on CHAIN_ID env var
// 8453 = Base Mainnet, 84532 = Base Sepolia
const isMainnet = CHAIN_ID === 8453;

// WalletConnect projectId - get one at https://cloud.walletconnect.com
// Required for mobile wallet connections (MetaMask Mobile, Rainbow, Trust, etc.)
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';

// Common connectors for all chains
const getConnectors = () => {
  const connectors = [
    injected(),
    coinbaseWallet({ appName: 'Basion.app' }),
  ];
  
  // Only add WalletConnect if projectId is configured
  if (walletConnectProjectId) {
    connectors.push(
      walletConnect({
        projectId: walletConnectProjectId,
        metadata: {
          name: 'Basion.app',
          description: 'Tap-to-earn game on Base Network',
          url: 'https://basion.app',
          icons: ['https://basion.app/icon.png'],
        },
        showQrModal: true,
      })
    );
  }
  
  return connectors;
};

// Configure both chains but only expose the active one
// This satisfies TypeScript while allowing runtime chain selection
export const config = isMainnet
  ? createConfig({
      chains: [base],
      connectors: getConnectors(),
      transports: {
        [base.id]: http(RPC_URL),
      },
    })
  : createConfig({
      chains: [baseSepolia],
      connectors: getConnectors(),
      transports: {
        [baseSepolia.id]: http(RPC_URL),
      },
    });

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
