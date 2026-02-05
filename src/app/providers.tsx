'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '@/config/wagmi';
import { useState, useEffect, useRef } from 'react';
import { useAccount, useSwitchChain, useDisconnect } from 'wagmi';
import { CHAIN_ID } from '@/config/constants';
import { sdk } from '@farcaster/miniapp-sdk';

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

  // Mini App: hide splash screen once UI is ready
  useEffect(() => {
    (async () => {
      try {
        // In some hosts (including preview tools), the bridge/context can take
        // a couple seconds to come online. Wait for Mini App context first.
        let inMiniApp = false;
        for (let i = 0; i < 5; i++) {
          inMiniApp = await sdk.isInMiniApp();
          if (inMiniApp) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!inMiniApp) return;

        // Avoid hanging forever if host bridge is unavailable.
        await Promise.race([
          sdk.actions.ready({ disableNativeGestures: true }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('miniapp ready timeout')), 5000)),
        ]);
      } catch {
        // No-op outside of Mini App environments
      }
    })();
  }, []);

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
