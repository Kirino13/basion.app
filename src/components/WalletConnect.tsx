'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';
import { Wallet } from 'lucide-react';

interface WalletConnectProps {
  className?: string;
}

const WalletConnect: React.FC<WalletConnectProps> = ({ className = '' }) => {
  const { address, isConnected, chainId, isConnecting, isReconnecting } = useAccount();
  const { connectors, connect, isPending, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const [isButtonDisabled, setIsButtonDisabled] = useState(false);

  const isWrongNetwork = isConnected && chainId !== baseSepolia.id;

  // Reset pending state after timeout (in case it gets stuck)
  useEffect(() => {
    if (isPending || isConnecting || isReconnecting) {
      setIsButtonDisabled(true);
      const timeout = setTimeout(() => {
        setIsButtonDisabled(false);
        reset(); // Reset connect state if stuck
      }, 10000); // 10 second timeout
      return () => clearTimeout(timeout);
    } else {
      setIsButtonDisabled(false);
    }
  }, [isPending, isConnecting, isReconnecting, reset]);

  // Handle connect with the first available connector (injected wallet like MetaMask/Rabby)
  const handleConnect = useCallback(() => {
    if (isButtonDisabled) return;
    
    const injectedConnector = connectors.find((c) => c.id === 'injected');
    if (injectedConnector) {
      connect({ connector: injectedConnector });
    } else if (connectors.length > 0) {
      connect({ connector: connectors[0] });
    }
  }, [isButtonDisabled, connectors, connect]);

  // Handle network switch
  const handleSwitchNetwork = useCallback(() => {
    switchChain({ chainId: baseSepolia.id });
  }, [switchChain]);

  // Memoize display address
  const displayAddress = useMemo(() => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }, [address]);

  if (isWrongNetwork) {
    return (
      <button
        onClick={handleSwitchNetwork}
        className={`py-3 px-6 rounded-xl font-bold text-sm shadow-lg transition-all flex items-center justify-center gap-2 bg-orange-500 text-white hover:bg-orange-600 shadow-orange-900/30 ${className}`}
      >
        <Wallet className="w-4 h-4" />
        Switch to Base
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        className={`py-3 px-6 rounded-xl font-bold text-sm shadow-lg transition-all flex items-center justify-center gap-2 bg-[#0052FF] text-white hover:bg-blue-700 shadow-blue-900/30 ${className}`}
      >
        <Wallet className="w-4 h-4" />
        {displayAddress}
      </button>
    );
  }

  const showConnecting = isPending || isConnecting || isReconnecting || isButtonDisabled;

  return (
    <button
      onClick={handleConnect}
      disabled={showConnecting}
      className={`py-3 px-6 rounded-xl font-bold text-sm shadow-lg transition-all flex items-center justify-center gap-2 bg-[#0052FF] text-white hover:bg-blue-700 shadow-blue-900/30 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      <Wallet className="w-4 h-4" />
      {showConnecting ? 'Connecting...' : 'Connect'}
    </button>
  );
};

export default React.memo(WalletConnect);
