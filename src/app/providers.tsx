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
        const w = window as unknown as Record<string, unknown>;
        // Default: not a Mini App until proven otherwise
        w.__BASION_MINIAPP__ = false;
        w.__BASION_BASEAPP__ = false;
        w.__BASION_MINIAPP_CLIENT_FID__ = null;
        w.__BASION_MINIAPP_PLATFORM_TYPE__ = null;

        // Strong heuristic for Base App / Mini App hosts:
        // Base App is a React Native client that typically injects ReactNativeWebView.
        // If we are on mobile and this bridge exists, treat as Base App early so the
        // first API calls can include x-basion-client without waiting for sdk.context.
        const ua = navigator.userAgent || '';
        const isMobileUA = /iPhone|iPad|iPod|Android|Mobile/i.test(ua);
        const hasRNBridge =
          typeof (window as unknown as { ReactNativeWebView?: { postMessage?: unknown } }).ReactNativeWebView?.postMessage ===
          'function';
        if (isMobileUA && hasRNBridge) {
          w.__BASION_MINIAPP__ = true;
          w.__BASION_BASEAPP__ = true;
          window.dispatchEvent(new Event('basion:client-env-changed'));
        }

        // In some hosts (including preview tools), the bridge/context can take
        // a couple seconds to come online. Wait for Mini App context first.
        let inMiniApp = false;
        for (let i = 0; i < 5; i++) {
          inMiniApp = await sdk.isInMiniApp();
          if (inMiniApp) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!inMiniApp) return;

        // Mark environment for other components (used for Base App boost detection)
        w.__BASION_MINIAPP__ = true;
        try {
          // Avoid hanging forever if host bridge is flaky
          const ctx = await Promise.race([
            sdk.context,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('miniapp context timeout')), 2500)),
          ]);
          const clientFid = (ctx as { client?: { clientFid?: number } })?.client?.clientFid;
          const platformType = (ctx as { client?: { platformType?: string } })?.client?.platformType;
          w.__BASION_MINIAPP_CLIENT_FID__ = typeof clientFid === 'number' ? clientFid : null;
          w.__BASION_MINIAPP_PLATFORM_TYPE__ = typeof platformType === 'string' ? platformType : null;

          // Default behavior: any *mobile* Mini App host is treated as Base App for bonus purposes.
          // This matches the requirement "тапы с телефона/эмулятора в Base App" and avoids desktop.
          const isMobileMiniApp = platformType === 'mobile';
          // Warpcast is commonly clientFid=9152; exclude it from Base App bonus by default.
          const isWarpcast = clientFid === 9152;
          w.__BASION_BASEAPP__ = isMobileMiniApp && !isWarpcast;
        } catch {
          // If context isn't available, still keep Mini App flag.
          // Base App hosts are mobile; fall back to UA.
          w.__BASION_BASEAPP__ = /iPhone|iPad|iPod|Android|Mobile/i.test(ua);
        } finally {
          window.dispatchEvent(new Event('basion:client-env-changed'));
        }

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
