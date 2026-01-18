'use client';

import React from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';
import { Wallet } from 'lucide-react';

interface WalletConnectProps {
  className?: string;
}

const WalletConnect: React.FC<WalletConnectProps> = ({ className = '' }) => {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const isWrongNetwork = isConnected && chainId !== baseSepolia.id;

  // Handle connect with the first available connector (injected wallet like MetaMask/Rabby)
  const handleConnect = () => {
    const injectedConnector = connectors.find((c) => c.id === 'injected');
    if (injectedConnector) {
      connect({ connector: injectedConnector });
    } else if (connectors.length > 0) {
      connect({ connector: connectors[0] });
    }
  };

  // Handle network switch
  const handleSwitchNetwork = () => {
    switchChain({ chainId: baseSepolia.id });
  };

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
        {address.slice(0, 6)}...{address.slice(-4)}
      </button>
    );
  }

  return (
    <button
      onClick={handleConnect}
      disabled={isPending}
      className={`py-3 px-6 rounded-xl font-bold text-sm shadow-lg transition-all flex items-center justify-center gap-2 bg-[#0052FF] text-white hover:bg-blue-700 shadow-blue-900/30 disabled:opacity-50 ${className}`}
    >
      <Wallet className="w-4 h-4" />
      {isPending ? 'Connecting...' : 'Connect'}
    </button>
  );
};

export default WalletConnect;
