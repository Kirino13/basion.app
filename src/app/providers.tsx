'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '@/config/wagmi';
import { useState, useEffect } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';

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
        <NetworkSwitcher>{children}</NetworkSwitcher>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
