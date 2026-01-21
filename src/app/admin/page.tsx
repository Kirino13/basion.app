'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { WalletConnect } from '@/components';
import { ADMIN_WALLET } from '@/config/constants';
import { decryptKey } from '@/lib/encryption';
import { Shield, Users, Wallet, ArrowDownToLine, RefreshCw, AlertTriangle, Eye, EyeOff, Copy, Check, Download, Zap, FileSpreadsheet, KeyRound } from 'lucide-react';
import * as XLSX from 'xlsx';

interface UserData {
  main_wallet: string;
  burner_wallet: string;
  total_points: number;
  premium_points: number;
  standard_points: number;
  taps_remaining: number;
  boost_percent: number;
  used_codes: string[];
  referred_by: string | null;
  referral_count: number;
  referral_bonus_claimed: boolean;
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
  const { signMessageAsync } = useSignMessage();
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
  
  // State for copied addresses
  const [copiedAddresses, setCopiedAddresses] = useState<Record<string, boolean>>({});
  
  // State for admin authentication
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigning, setIsSigning] = useState(false);

  const isAdmin = address?.toLowerCase() === ADMIN_WALLET;

  // Function to sign and authenticate admin
  const authenticateAdmin = useCallback(async () => {
    if (!address || !isAdmin) return;
    
    setIsSigning(true);
    setAuthError(null);
    
    try {
      const timestamp = Date.now().toString();
      const message = `Basion Admin Access ${timestamp}`;
      
      const signature = await signMessageAsync({ message });
      
      // Test the signature by fetching data
      const response = await fetch('/api/admin/data', {
        headers: {
          'x-admin-address': address,
          'x-admin-signature': signature,
          'x-admin-timestamp': timestamp,
        },
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Authentication failed');
      }
      
      const data = await response.json();
      const usersData = data.users || [];
      const burnersData = data.burners || [];
      
      // Sort burners to match users order (by main_wallet)
      const userOrder = new Map<string, number>(usersData.map((u: UserData, idx: number) => [u.main_wallet.toLowerCase(), idx]));
      const sortedBurners = [...burnersData].sort((a: BurnerData, b: BurnerData) => {
        const orderA: number = userOrder.get(a.main_wallet.toLowerCase()) ?? 999;
        const orderB: number = userOrder.get(b.main_wallet.toLowerCase()) ?? 999;
        return orderA - orderB;
      });
      
      setUsers(usersData);
      setBurners(sortedBurners);
      setIsAuthenticated(true);
      setIsLoading(false);
    } catch (error) {
      console.error('Authentication failed:', error);
      setAuthError(error instanceof Error ? error.message : 'Authentication failed');
      setIsAuthenticated(false);
      setIsLoading(false);
    } finally {
      setIsSigning(false);
    }
  }, [address, isAdmin, signMessageAsync]);

  // Reset auth state when wallet changes
  useEffect(() => {
    setIsAuthenticated(false);
    setAuthError(null);
    if (!isAdmin) {
      setIsLoading(false);
    }
  }, [address, isAdmin]);

  const fetchData = useCallback(async () => {
    if (!address || !isAdmin) return;
    
    setIsLoading(true);
    try {
      const timestamp = Date.now().toString();
      const message = `Basion Admin Access ${timestamp}`;
      const signature = await signMessageAsync({ message });
      
      const response = await fetch('/api/admin/data', {
        headers: {
          'x-admin-address': address,
          'x-admin-signature': signature,
          'x-admin-timestamp': timestamp,
        },
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch admin data');
      }
      
      const data = await response.json();
      const usersData = data.users || [];
      const burnersData = data.burners || [];
      
      // Sort burners to match users order (by main_wallet)
      const userOrder = new Map<string, number>(usersData.map((u: UserData, idx: number) => [u.main_wallet.toLowerCase(), idx]));
      const sortedBurners = [...burnersData].sort((a: BurnerData, b: BurnerData) => {
        const orderA: number = userOrder.get(a.main_wallet.toLowerCase()) ?? 999;
        const orderB: number = userOrder.get(b.main_wallet.toLowerCase()) ?? 999;
        return orderA - orderB;
      });
      
      setUsers(usersData);
      setBurners(sortedBurners);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      setUsers([]);
      setBurners([]);
    } finally {
      setIsLoading(false);
    }
  }, [address, isAdmin, signMessageAsync]);

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
      // Sign the withdraw request
      const timestamp = Date.now().toString();
      const message = `Basion Admin Withdraw ${timestamp}`;
      const signature = await signMessageAsync({ message });
      
      const response = await fetch('/api/admin/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          burnerAddresses: selectedBurners,
          adminWallet: address,
          signature,
          timestamp,
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

  // Handle copy address to clipboard
  const handleCopyAddress = (address: string, uniqueKey: string) => {
    navigator.clipboard.writeText(address);
    setCopiedAddresses((prev) => ({ ...prev, [uniqueKey]: true }));
    setTimeout(() => {
      setCopiedAddresses((prev) => ({ ...prev, [uniqueKey]: false }));
    }, 2000);
  };

  // Calculate totals
  const totalTapsDone = users.reduce((sum, user) => sum + (user.total_points || 0), 0);
  const totalTapsRemaining = users.reduce((sum, user) => sum + (user.taps_remaining || 0), 0);

  // Export users to CSV
  const handleExportCSV = () => {
    if (users.length === 0) {
      alert('No users to export');
      return;
    }

    // CSV header
    const headers = ['main_wallet', 'burner_wallet', 'total_points', 'premium_points', 'standard_points', 'taps_remaining', 'boost_percent', 'used_codes', 'referred_by', 'referral_count'];
    
    // CSV rows
    const rows = users.map(user => [
      user.main_wallet,
      user.burner_wallet || '',
      user.total_points || 0,
      user.premium_points || 0,
      user.standard_points || 0,
      user.taps_remaining || 0,
      user.boost_percent || 0,
      (user.used_codes || []).join(';'),
      user.referred_by || '',
      user.referral_count || 0
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

  // Export users to Excel
  const handleExportExcel = () => {
    if (users.length === 0) {
      alert('No users to export');
      return;
    }

    // Prepare data for Excel
    const excelData = users.map(user => ({
      'Main Wallet': user.main_wallet,
      'Burner Wallet': user.burner_wallet || '',
      'Total Points': user.total_points || 0,
      'Premium Points': user.premium_points || 0,
      'Standard Points': user.standard_points || 0,
      'Taps Remaining': user.taps_remaining || 0,
      'Boost %': user.boost_percent || 0,
      'Used Codes': (user.used_codes || []).join(', '),
      'Referred By': user.referred_by || '',
      'Referrals': user.referral_count || 0,
    }));

    // Add summary row
    excelData.push({
      'Main Wallet': 'TOTAL',
      'Burner Wallet': '',
      'Total Points': totalTapsDone,
      'Premium Points': users.reduce((sum, u) => sum + (u.premium_points || 0), 0),
      'Standard Points': users.reduce((sum, u) => sum + (u.standard_points || 0), 0),
      'Taps Remaining': totalTapsRemaining,
      'Boost %': users.reduce((sum, u) => sum + (u.boost_percent || 0), 0),
      'Used Codes': '',
      'Referred By': '',
      'Referrals': users.reduce((sum, u) => sum + (u.referral_count || 0), 0),
    });

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);

    // Set column widths
    ws['!cols'] = [
      { wch: 45 }, // Main Wallet
      { wch: 45 }, // Burner Wallet
      { wch: 15 }, // Total Points
      { wch: 15 }, // Premium Points
      { wch: 15 }, // Standard Points
      { wch: 15 }, // Taps Remaining
      { wch: 10 }, // Boost %
      { wch: 25 }, // Used Codes
      { wch: 45 }, // Referred By
      { wch: 10 }, // Referrals
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Users');

    // Generate filename with date
    const filename = `basion_users_${new Date().toISOString().split('T')[0]}.xlsx`;
    
    // Download file
    XLSX.writeFile(wb, filename);
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

  // Admin needs to authenticate with signature
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-8 max-w-md w-full text-center">
          <KeyRound className="w-16 h-16 text-blue-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-4">Admin Authentication</h1>
          <p className="text-white/60 mb-6">
            Sign a message with your wallet to verify admin access.
          </p>
          
          {authError && (
            <div className="mb-4 p-3 bg-red-500/20 rounded-lg text-red-400 text-sm">
              {authError}
            </div>
          )}
          
          <button
            onClick={authenticateAdmin}
            disabled={isSigning}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2"
          >
            {isSigning ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                Signing...
              </>
            ) : (
              <>
                <KeyRound className="w-5 h-5" />
                Sign to Authenticate
              </>
            )}
          </button>
          
          <p className="text-white/40 text-xs mt-4">
            This signature proves you own the admin wallet and is valid for this session only.
          </p>
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

          <div className="flex items-center gap-3">
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-3 py-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-all"
              title="Export Users to CSV"
            >
              <Download className="w-4 h-4" />
              <span className="text-sm font-medium">CSV</span>
            </button>
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-2 px-3 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-all"
              title="Export Users to Excel"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span className="text-sm font-medium">Excel</span>
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
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <Users className="w-5 h-5 text-blue-400" />
              <span className="text-white/60">Total Users</span>
            </div>
            <p className="text-3xl font-bold text-white">{users.length}</p>
          </div>

          <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <Zap className="w-5 h-5 text-yellow-400" />
              <span className="text-white/60">Total Taps Done</span>
            </div>
            <p className="text-3xl font-bold text-yellow-400">{totalTapsDone.toLocaleString()}</p>
          </div>

          <div className="bg-white/10 backdrop-blur-xl rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <Zap className="w-5 h-5 text-orange-400" />
              <span className="text-white/60">Taps Remaining</span>
            </div>
            <p className="text-3xl font-bold text-orange-400">{totalTapsRemaining.toLocaleString()}</p>
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
              <ArrowDownToLine className="w-5 h-5 text-cyan-400" />
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
                    <th className="pb-3 font-medium">Boost</th>
                    <th className="pb-3 font-medium">Refs</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.main_wallet} className="border-b border-white/5">
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm text-white">
                            {user.main_wallet.slice(0, 8)}...{user.main_wallet.slice(-6)}
                          </span>
                          <button
                            onClick={() => handleCopyAddress(user.main_wallet, `user-main-${user.main_wallet}`)}
                            className="p-1 bg-white/10 hover:bg-white/20 rounded text-white/60 hover:text-white transition-all"
                            title="Copy address"
                          >
                            {copiedAddresses[`user-main-${user.main_wallet}`] ? (
                              <Check className="w-3 h-3 text-green-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="py-3">
                        {user.burner_wallet ? (
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-white/60">
                              {user.burner_wallet.slice(0, 8)}...{user.burner_wallet.slice(-6)}
                            </span>
                            <button
                              onClick={() => handleCopyAddress(user.burner_wallet, `user-burner-${user.burner_wallet}`)}
                              className="p-1 bg-white/10 hover:bg-white/20 rounded text-white/60 hover:text-white transition-all"
                              title="Copy address"
                            >
                              {copiedAddresses[`user-burner-${user.burner_wallet}`] ? (
                                <Check className="w-3 h-3 text-green-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        ) : (
                          <span className="text-white/40">-</span>
                        )}
                      </td>
                      <td className="py-3 text-white">{(user.total_points || 0).toLocaleString()}</td>
                      <td className="py-3 text-green-400">{(user.premium_points || 0).toLocaleString()}</td>
                      <td className="py-3 text-blue-400">{(user.standard_points || 0).toLocaleString()}</td>
                      <td className="py-3 text-white">{(user.taps_remaining || 0).toLocaleString()}</td>
                      <td className="py-3 text-purple-400 font-medium">{user.boost_percent || 0}%</td>
                      <td className="py-3 text-cyan-400">{user.referral_count || 0}</td>
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
                  {burners.map((burner) => (
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
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm text-white">
                            {burner.burner_wallet.slice(0, 8)}...{burner.burner_wallet.slice(-6)}
                          </span>
                          <button
                            onClick={() => handleCopyAddress(burner.burner_wallet, `burner-${burner.burner_wallet}`)}
                            className="p-1 bg-white/10 hover:bg-white/20 rounded text-white/60 hover:text-white transition-all"
                            title="Copy address"
                          >
                            {copiedAddresses[`burner-${burner.burner_wallet}`] ? (
                              <Check className="w-3 h-3 text-green-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm text-white/60">
                            {burner.main_wallet.slice(0, 8)}...{burner.main_wallet.slice(-6)}
                          </span>
                          <button
                            onClick={() => handleCopyAddress(burner.main_wallet, `burner-main-${burner.main_wallet}`)}
                            className="p-1 bg-white/10 hover:bg-white/20 rounded text-white/60 hover:text-white transition-all"
                            title="Copy address"
                          >
                            {copiedAddresses[`burner-main-${burner.main_wallet}`] ? (
                              <Check className="w-3 h-3 text-green-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
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
