'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '@/config/wagmi';
import { useState, useEffect, useRef } from 'react';
import { useAccount, useSwitchChain, useDisconnect } from 'wagmi';
import { CHAIN_ID } from '@/config/constants';

// Component to handle wallet switching - just disconnect on switch, don't clear anything
function WalletGuard({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const previousAddressRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) {
      previousAddressRef.current = null;
      return;
    }

    // If we had a previous address and it changed = wallet switch in MetaMask/Rabby
    if (previousAddressRef.current && previousAddressRef.current.toLowerCase() !== address.toLowerCase()) {
      disconnect();
      return;
    }

    // Track current address
    previousAddressRef.current = address;
  }, [address, isConnected, disconnect]);

  return <>{children}</>;
}

// Component to handle auto network switch
function NetworkSwitcher({ children }: { children: React.ReactNode }) {
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  useEffect(() => {
    // Auto switch to configured chain when connected to wrong network
    if (isConnected && chainId && chainId !== CHAIN_ID) {
      switchChain({ chainId: CHAIN_ID as 8453 | 84532 });
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
