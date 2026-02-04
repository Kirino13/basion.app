'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { Wallet, X, Smartphone, Monitor } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CHAIN_ID } from '@/config/constants';

interface WalletConnectProps {
  className?: string;
}

const WalletConnect: React.FC<WalletConnectProps> = ({ className = '' }) => {
  const { address, isConnected, chainId, isConnecting, isReconnecting } = useAccount();
  const { connectors, connect, isPending, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [isButtonDisabled, setIsButtonDisabled] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const switchAttemptedRef = useRef(false);

  const isWrongNetwork = isConnected && chainId !== CHAIN_ID;

  // Detect mobile device
  const isMobile = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  }, []);

  // Get available connectors
  const injectedConnector = useMemo(() => connectors.find((c) => c.id === 'injected'), [connectors]);
  const walletConnectConnector = useMemo(() => connectors.find((c) => c.id === 'walletConnect'), [connectors]);
  const coinbaseConnector = useMemo(() => connectors.find((c) => c.id === 'coinbaseWalletSDK'), [connectors]);

  // Auto-switch network when connected to wrong chain
  useEffect(() => {
    if (isWrongNetwork && !isSwitching && !switchAttemptedRef.current) {
      switchAttemptedRef.current = true;
      switchChain({ chainId: CHAIN_ID as 8453 | 84532 });
    }
    // Reset flag when on correct network
    if (!isWrongNetwork) {
      switchAttemptedRef.current = false;
    }
  }, [isWrongNetwork, isSwitching, switchChain]);

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

  // Close modal on successful connection
  useEffect(() => {
    if (isConnected) {
      setShowModal(false);
    }
  }, [isConnected]);

  // Handle connect button click
  const handleConnectClick = useCallback(() => {
    if (isButtonDisabled) return;
    
    // On mobile or if WalletConnect is available, show modal
    if (isMobile || walletConnectConnector) {
      setShowModal(true);
    } else if (injectedConnector) {
      // Desktop with only injected - connect directly
      connect({ connector: injectedConnector });
    } else if (connectors.length > 0) {
      connect({ connector: connectors[0] });
    }
  }, [isButtonDisabled, isMobile, walletConnectConnector, injectedConnector, connectors, connect]);

  // Allow other UI elements (e.g. Deposit button) to open connect flow.
  // This avoids duplicating wallet-connect UI/logic across components.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handler = () => {
      if (isConnected) return;
      handleConnectClick();
    };

    window.addEventListener('basion:open-wallet-connect', handler);
    return () => window.removeEventListener('basion:open-wallet-connect', handler);
  }, [handleConnectClick, isConnected]);

  // Connect with specific connector
  const handleConnectWith = useCallback((connector: typeof connectors[0]) => {
    connect({ connector });
    // Modal will close on successful connection via useEffect
  }, [connect]);

  // Handle manual network switch (fallback)
  const handleSwitchNetwork = useCallback(() => {
    switchAttemptedRef.current = false; // Reset to allow retry
    switchChain({ chainId: CHAIN_ID as 8453 | 84532 });
  }, [switchChain]);

  // Memoize display address
  const displayAddress = useMemo(() => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }, [address]);

  // Show switching state or fallback button
  if (isWrongNetwork) {
    return (
      <button
        onClick={handleSwitchNetwork}
        disabled={isSwitching}
        className={`px-3 lg:px-6 rounded-xl font-bold text-xs lg:text-sm shadow-lg transition-all flex items-center justify-center gap-1.5 bg-orange-500 text-white hover:bg-orange-600 shadow-orange-900/30 disabled:opacity-70 ${className}`}
      >
        <Wallet className="w-4 h-4 shrink-0" />
        <span className="truncate">{isSwitching ? '...' : 'Switch'}</span>
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        className={`px-3 lg:px-6 rounded-xl font-bold text-xs lg:text-sm shadow-lg transition-all flex items-center justify-center gap-1.5 bg-[#0052FF] text-white hover:bg-blue-700 shadow-blue-900/30 ${className}`}
      >
        <Wallet className="w-4 h-4 shrink-0" />
        <span className="truncate">{displayAddress}</span>
      </button>
    );
  }

  const showConnecting = isPending || isConnecting || isReconnecting || isButtonDisabled;

  return (
    <>
      <button
        onClick={handleConnectClick}
        disabled={showConnecting}
        className={`px-3 lg:px-6 rounded-xl font-bold text-xs lg:text-sm shadow-lg transition-all flex items-center justify-center gap-1.5 bg-[#0052FF] text-white hover:bg-blue-700 shadow-blue-900/30 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        <Wallet className="w-4 h-4" />
        {showConnecting ? '...' : 'Connect'}
      </button>

      {/* Wallet Selection Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowModal(false)}
            className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-end lg:items-center justify-center p-0 lg:p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-t-3xl lg:rounded-3xl p-6 w-full max-w-full lg:max-w-sm shadow-2xl relative safe-bottom"
            >
              {/* Drag handle for mobile */}
              <div className="lg:hidden w-12 h-1 bg-white/30 rounded-full mx-auto mb-4" />
              
              <button
                onClick={() => setShowModal(false)}
                className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>

              <h3 className="text-white font-bold text-lg mb-4 text-center">Connect Wallet</h3>

              <div className="flex flex-col gap-3">
                {/* Browser Wallet (Desktop) */}
                {injectedConnector && !isMobile && (
                  <button
                    onClick={() => handleConnectWith(injectedConnector)}
                    className="flex items-center gap-3 w-full p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 transition-all"
                  >
                    <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center">
                      <Monitor className="w-5 h-5 text-white" />
                    </div>
                    <div className="text-left">
                      <p className="text-white font-semibold">Browser Wallet</p>
                      <p className="text-white/50 text-xs">MetaMask, Rabby, etc.</p>
                    </div>
                  </button>
                )}

                {/* WalletConnect (Mobile) */}
                {walletConnectConnector && (
                  <button
                    onClick={() => handleConnectWith(walletConnectConnector)}
                    className="flex items-center gap-3 w-full p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 transition-all"
                  >
                    <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
                      <Smartphone className="w-5 h-5 text-white" />
                    </div>
                    <div className="text-left">
                      <p className="text-white font-semibold">Mobile Wallet</p>
                      <p className="text-white/50 text-xs">MetaMask, Rainbow, Trust</p>
                    </div>
                  </button>
                )}

                {/* Coinbase Wallet */}
                {coinbaseConnector && (
                  <button
                    onClick={() => handleConnectWith(coinbaseConnector)}
                    className="flex items-center gap-3 w-full p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 transition-all"
                  >
                    <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                      <span className="text-white font-bold text-sm">CB</span>
                    </div>
                    <div className="text-left">
                      <p className="text-white font-semibold">Coinbase Wallet</p>
                      <p className="text-white/50 text-xs">Connect with Coinbase</p>
                    </div>
                  </button>
                )}

                {/* Fallback if no WalletConnect configured */}
                {!walletConnectConnector && isMobile && injectedConnector && (
                  <button
                    onClick={() => handleConnectWith(injectedConnector)}
                    className="flex items-center gap-3 w-full p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 transition-all"
                  >
                    <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center">
                      <Wallet className="w-5 h-5 text-white" />
                    </div>
                    <div className="text-left">
                      <p className="text-white font-semibold">In-App Browser</p>
                      <p className="text-white/50 text-xs">Open in wallet app</p>
                    </div>
                  </button>
                )}
              </div>

              <p className="text-white/30 text-xs text-center mt-4">
                By connecting, you agree to the Terms of Service
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default React.memo(WalletConnect);
