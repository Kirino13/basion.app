'use client';

import React, { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { WalletConnect } from '@/components';
import { ADMIN_WALLET } from '@/config/constants';
import { decryptKey } from '@/lib/encryption';
import { Shield, Users, Wallet, ArrowDownToLine, RefreshCw, AlertTriangle, Eye, EyeOff, Copy, Check, Download } from 'lucide-react';

interface UserData {
  main_wallet: string;
  burner_wallet: string;
  total_points: number;
  premium_points: number;
  standard_points: number;
  taps_remaining: number;
}

interface BurnerData {
  burner_wallet: string;
  main_wallet: string;
  encrypted_key?: string;
  withdrawn: boolean;
  balance?: string;
}

export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const [users, setUsers] = useState<UserData[]>([]);
  const [burners, setBurners] = useState<BurnerData[]>([]);
  const [selectedBurners, setSelectedBurners] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<{ success: boolean; message: string } | null>(null);
  
  // States for private key reveal
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [decryptedKeys, setDecryptedKeys] = useState<Record<string, string>>({});
  const [copiedKeys, setCopiedKeys] = useState<Record<string, boolean>>({});

  const isAdmin = address?.toLowerCase() === ADMIN_WALLET;

  // Fetch data on mount
  useEffect(() => {
    if (isAdmin) {
      fetchData();
    } else {
      setIsLoading(false);
    }
  }, [isAdmin]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/admin/data', {
        headers: {
          'x-admin-address': address || '',
        },
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch admin data');
      }
      
      const data = await response.json();
      setUsers(data.users || []);
      setBurners(data.burners || []);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      setUsers([]);
      setBurners([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectBurner = (burnerAddress: string) => {
    setSelectedBurners((prev) =>
      prev.includes(burnerAddress) ? prev.filter((b) => b !== burnerAddress) : [...prev, burnerAddress]
    );
  };

  const handleSelectAll = () => {
    if (selectedBurners.length === burners.filter((b) => !b.withdrawn).length) {
      setSelectedBurners([]);
    } else {
      setSelectedBurners(burners.filter((b) => !b.withdrawn).map((b) => b.burner_wallet));
    }
  };

  const handleWithdraw = async () => {
    if (selectedBurners.length === 0 || !address) return;

    setIsWithdrawing(true);
    setWithdrawResult(null);

    try {
      const response = await fetch('/api/admin/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          burnerAddresses: selectedBurners,
          adminWallet: address,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setWithdrawResult({
          success: true,
          message: `Successfully withdrew ${data.totalWithdrawn} ETH`,
        });
        setSelectedBurners([]);
        fetchData();
      } else {
        setWithdrawResult({
          success: false,
          message: data.error || 'Withdrawal failed',
        });
      }
    } catch (error) {
      setWithdrawResult({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsWithdrawing(false);
    }
  };

  // Handle reveal/hide private key
  const handleRevealKey = (burnerAddress: string, encryptedKey?: string) => {
    if (!encryptedKey) {
      alert('Encrypted key not available');
      return;
    }

    if (revealedKeys[burnerAddress]) {
      // Hide key
      setRevealedKeys((prev) => ({ ...prev, [burnerAddress]: false }));
      return;
    }

    try {
      const decrypted = decryptKey(encryptedKey);
      if (!decrypted) {
        alert('Failed to decrypt - key may be corrupted');
        return;
      }
      setDecryptedKeys((prev) => ({ ...prev, [burnerAddress]: decrypted }));
      setRevealedKeys((prev) => ({ ...prev, [burnerAddress]: true }));
    } catch (error) {
      console.error('Failed to decrypt key:', error);
      alert('Failed to decrypt private key');
    }
  };

  // Handle copy private key to clipboard
  const handleCopyKey = (burnerAddress: string) => {
    const key = decryptedKeys[burnerAddress];
    if (key) {
      navigator.clipboard.writeText(key);
      setCopiedKeys((prev) => ({ ...prev, [burnerAddress]: true }));
      setTimeout(() => {
        setCopiedKeys((prev) => ({ ...prev, [burnerAddress]: false }));
      }, 2000);
    }
  };

  // Export users to CSV
  const handleExportCSV = () => {
    if (users.length === 0) {
      alert('No users to export');
      return;
    }

    // CSV header
    const headers = ['main_wallet', 'burner_wallet', 'total_points', 'premium_points', 'standard_points', 'taps_remaining'];
    
    // CSV rows
    const rows = users.map(user => [
      user.main_wallet,
      user.burner_wallet || '',
      user.total_points || 0,
      user.premium_points || 0,
      user.standard_points || 0,
      user.taps_remaining || 0
    ]);

    // Combine header and rows
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `basion_users_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Not connected
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-8 max-w-md w-full text-center">
          <Shield className="w-16 h-16 text-blue-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-4">Admin Panel</h1>
          <p className="text-white/60 mb-6">Connect your admin wallet to access the panel.</p>
          <WalletConnect />
        </div>
      </div>
    );
  }

  // Not admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-8 max-w-md w-full text-center">
          <AlertTriangle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-4">Access Denied</h1>
          <p className="text-white/60 mb-2">This wallet is not authorized to access the admin panel.</p>
          <p className="text-white/40 text-sm font-mono">{address}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-500/20 rounded-xl">
              <Shield className="w-8 h-8 text-blue-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Admin Panel</h1>
              <p className="text-white/60 text-sm">Basion.app Management</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-4 py-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-all"
              title="Export Users to CSV"
            >
              <Download className="w-4 h-4" />
              <span className="text-sm font-medium">Export CSV</span>
            </button>
            <button
              onClick={fetchData}
              className="p-2 bg-white/10 rounded-lg text-white/60 hover:text-white hover:bg-white/20 transition-all"
              title="Refresh Data"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <WalletConnect />
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <Users className="w-5 h-5 text-blue-400" />
              <span className="text-white/60">Total Users</span>
            </div>
            <p className="text-3xl font-bold text-white">{users.length}</p>
          </div>

          <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <Wallet className="w-5 h-5 text-green-400" />
              <span className="text-white/60">Burner Wallets</span>
            </div>
            <p className="text-3xl font-bold text-white">{burners.length}</p>
          </div>

          <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <ArrowDownToLine className="w-5 h-5 text-yellow-400" />
              <span className="text-white/60">Pending Withdraw</span>
            </div>
            <p className="text-3xl font-bold text-white">{burners.filter((b) => !b.withdrawn).length}</p>
          </div>

          <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <Shield className="w-5 h-5 text-purple-400" />
              <span className="text-white/60">Selected</span>
            </div>
            <p className="text-3xl font-bold text-white">{selectedBurners.length}</p>
          </div>
        </div>

        {/* Withdraw Result */}
        {withdrawResult && (
          <div
            className={`mb-6 p-4 rounded-xl ${
              withdrawResult.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            }`}
          >
            {withdrawResult.message}
          </div>
        )}

        {/* Users Table */}
        <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6 mb-8">
          <h2 className="text-xl font-bold text-white mb-4">Users</h2>

          {isLoading ? (
            <div className="text-center py-8 text-white/60">Loading...</div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-white/60">No users yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-white/60 border-b border-white/10">
                    <th className="pb-3 font-medium">Main Wallet</th>
                    <th className="pb-3 font-medium">Burner</th>
                    <th className="pb-3 font-medium">Total Pts</th>
                    <th className="pb-3 font-medium">Premium</th>
                    <th className="pb-3 font-medium">Standard</th>
                    <th className="pb-3 font-medium">Taps Left</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.main_wallet} className="border-b border-white/5">
                      <td className="py-3 font-mono text-sm text-white">
                        {user.main_wallet.slice(0, 8)}...{user.main_wallet.slice(-6)}
                      </td>
                      <td className="py-3 font-mono text-sm text-white/60">
                        {user.burner_wallet
                          ? `${user.burner_wallet.slice(0, 8)}...${user.burner_wallet.slice(-6)}`
                          : '-'}
                      </td>
                      <td className="py-3 text-white">{(user.total_points || 0).toLocaleString()}</td>
                      <td className="py-3 text-green-400">{(user.premium_points || 0).toLocaleString()}</td>
                      <td className="py-3 text-blue-400">{(user.standard_points || 0).toLocaleString()}</td>
                      <td className="py-3 text-white">{(user.taps_remaining || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Burner Wallets Table */}
        <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white">Burner Wallets</h2>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSelectAll}
                className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all text-sm"
              >
                {selectedBurners.length === burners.filter((b) => !b.withdrawn).length
                  ? 'Deselect All'
                  : 'Select All'}
              </button>

              <button
                onClick={handleWithdraw}
                disabled={selectedBurners.length === 0 || isWithdrawing}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm flex items-center gap-2"
              >
                <ArrowDownToLine className="w-4 h-4" />
                {isWithdrawing ? 'Withdrawing...' : `Withdraw (${selectedBurners.length})`}
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-white/60">Loading...</div>
          ) : burners.length === 0 ? (
            <div className="text-center py-8 text-white/60">No burner wallets yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-white/60 border-b border-white/10">
                    <th className="pb-3 font-medium w-10"></th>
                    <th className="pb-3 font-medium">Burner Wallet</th>
                    <th className="pb-3 font-medium">Main Wallet</th>
                    <th className="pb-3 font-medium">Balance</th>
                    <th className="pb-3 font-medium">Private Key</th>
                    <th className="pb-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Sort burners to match Users table order */}
                  {[...burners].sort((a, b) => {
                    const indexA = users.findIndex(u => u.main_wallet.toLowerCase() === a.main_wallet.toLowerCase());
                    const indexB = users.findIndex(u => u.main_wallet.toLowerCase() === b.main_wallet.toLowerCase());
                    // If not found in users, put at the end
                    if (indexA === -1) return 1;
                    if (indexB === -1) return -1;
                    return indexA - indexB;
                  }).map((burner) => (
                    <tr key={burner.burner_wallet} className="border-b border-white/5">
                      <td className="py-3">
                        <input
                          type="checkbox"
                          checked={selectedBurners.includes(burner.burner_wallet)}
                          onChange={() => handleSelectBurner(burner.burner_wallet)}
                          disabled={burner.withdrawn}
                          className="w-4 h-4 rounded"
                        />
                      </td>
                      <td className="py-3 font-mono text-sm text-white">
                        {burner.burner_wallet.slice(0, 8)}...{burner.burner_wallet.slice(-6)}
                      </td>
                      <td className="py-3 font-mono text-sm text-white/60">
                        {burner.main_wallet.slice(0, 8)}...{burner.main_wallet.slice(-6)}
                      </td>
                      <td className="py-3 text-white">{burner.balance || '-'} ETH</td>
                      <td className="py-3">
                        {burner.encrypted_key ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleRevealKey(burner.burner_wallet, burner.encrypted_key)}
                              className="p-1.5 bg-white/10 hover:bg-white/20 rounded text-white/60 hover:text-white transition-all"
                              title={revealedKeys[burner.burner_wallet] ? 'Hide key' : 'Show key'}
                            >
                              {revealedKeys[burner.burner_wallet] ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </button>
                            {revealedKeys[burner.burner_wallet] && (
                              <>
                                <span className="font-mono text-xs text-yellow-400 max-w-[180px] truncate">
                                  {decryptedKeys[burner.burner_wallet]}
                                </span>
                                <button
                                  onClick={() => handleCopyKey(burner.burner_wallet)}
                                  className="p-1.5 bg-white/10 hover:bg-white/20 rounded text-white/60 hover:text-white transition-all"
                                  title="Copy key"
                                >
                                  {copiedKeys[burner.burner_wallet] ? (
                                    <Check className="w-4 h-4 text-green-400" />
                                  ) : (
                                    <Copy className="w-4 h-4" />
                                  )}
                                </button>
                              </>
                            )}
                          </div>
                        ) : (
                          <span className="text-white/40 text-xs">N/A</span>
                        )}
                      </td>
                      <td className="py-3">
                        {burner.withdrawn ? (
                          <span className="px-2 py-1 bg-gray-500/20 text-gray-400 rounded text-xs">Withdrawn</span>
                        ) : (
                          <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs">Active</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
