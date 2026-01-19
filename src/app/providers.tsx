'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '@/config/wagmi';
import { useState, useEffect, useRef } from 'react';
import { useAccount, useSwitchChain, useDisconnect } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';

// Storage key for tracking connected wallet
const CONNECTED_WALLET_KEY = 'basion_connected_wallet';

// Component to handle wallet switching protection
function WalletGuard({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const previousAddressRef = useRef<string | null>(null);
  const isFirstMount = useRef(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // On first mount, check if this is the same wallet that was previously connected
    if (isFirstMount.current && isConnected && address) {
      const savedWallet = localStorage.getItem(CONNECTED_WALLET_KEY);
      
      // If there's a saved wallet and it's different from current, disconnect
      if (savedWallet && savedWallet.toLowerCase() !== address.toLowerCase()) {
        console.log('Different wallet detected on load. Disconnecting for security.');
        disconnect();
        localStorage.removeItem(CONNECTED_WALLET_KEY);
        isFirstMount.current = false;
        return;
      }
      
      // Save current wallet as connected
      localStorage.setItem(CONNECTED_WALLET_KEY, address);
      previousAddressRef.current = address;
      isFirstMount.current = false;
      return;
    }

    // After first mount, detect wallet switches
    if (!isFirstMount.current && isConnected && address) {
      // If address changed (user switched in MetaMask/Rabby)
      if (previousAddressRef.current && previousAddressRef.current.toLowerCase() !== address.toLowerCase()) {
        console.log('Wallet switched. Disconnecting - please reconnect manually.');
        disconnect();
        localStorage.removeItem(CONNECTED_WALLET_KEY);
        return;
      }
      
      // Update tracked address
      previousAddressRef.current = address;
      localStorage.setItem(CONNECTED_WALLET_KEY, address);
    }

    // If disconnected, clear saved wallet
    if (!isConnected) {
      localStorage.removeItem(CONNECTED_WALLET_KEY);
      previousAddressRef.current = null;
    }
  }, [address, isConnected, disconnect]);

  return <>{children}</>;
}

// Component to handle auto network switch
function NetworkSwitcher({ children }: { children: React.ReactNode }) {
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  useEffect(() => {
    // Auto switch to Base Sepolia when connected to wrong network
    if (isConnected && chainId && chainId !== baseSepolia.id) {
      switchChain({ chainId: baseSepolia.id });
    }
  }, [isConnected, chainId, switchChain]);

  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <WalletGuard>
          <NetworkSwitcher>{children}</NetworkSwitcher>
        </WalletGuard>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
