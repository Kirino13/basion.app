"""
Basion Bot SDK - Complete Python implementation
Works with only: private key + proxy (optional)

Author: Basion Team
Version: 1.0.0

Usage:
    python basion_bot.py <private_key> [proxy]
    python basion_bot.py wallets.txt
"""

import time
import json
import asyncio
from typing import Optional, Dict, Any, Tuple
from dataclasses import dataclass
from pathlib import Path

from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware
from eth_account import Account
from eth_account.messages import encode_defunct
import httpx


# =============================================================================
# CONSTANTS
# =============================================================================

API_BASE = "https://basion.app"
RPC_URL = "https://mainnet.base.org"
CONTRACT_ADDRESS = "0x21f7944eD2F9ae2d09C9CcF55EDa92D1956d921a"
CHAIN_ID = 8453

# Package options: {package_id: (usd_price, taps, eth_price)}
PACKAGES = {
    0: (3, 5000, 0.001),      # $3 = 5000 taps = 0.001 ETH
    1: (10, 20000, 0.003),    # $10 = 20000 taps = 0.003 ETH
}

# Contract ABI (minimal - only functions we need)
CONTRACT_ABI = [
    # User functions
    {
        "inputs": [{"internalType": "address", "name": "burner", "type": "address"}],
        "name": "registerBurner",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "uint256", "name": "packageId", "type": "uint256"},
            {"internalType": "address", "name": "_referrer", "type": "address"}
        ],
        "name": "deposit",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "tap",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "uint256", "name": "count", "type": "uint256"}],
        "name": "batchTap",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    # View functions
    {
        "inputs": [{"internalType": "address", "name": "user", "type": "address"}],
        "name": "getPoints",
        "outputs": [
            {"internalType": "uint256", "name": "premium", "type": "uint256"},
            {"internalType": "uint256", "name": "standard", "type": "uint256"},
            {"internalType": "uint256", "name": "total", "type": "uint256"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "address", "name": "user", "type": "address"}],
        "name": "getUserInfo",
        "outputs": [
            {"internalType": "uint256", "name": "taps", "type": "uint256"},
            {"internalType": "uint256", "name": "multiplier", "type": "uint256"},
            {"internalType": "address", "name": "burner", "type": "address"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "address", "name": "", "type": "address"}],
        "name": "tapBalance",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "address", "name": "", "type": "address"}],
        "name": "userToBurner",
        "outputs": [{"internalType": "address", "name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "address", "name": "", "type": "address"}],
        "name": "pointsMultiplier",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "address", "name": "", "type": "address"}],
        "name": "referrer",
        "outputs": [{"internalType": "address", "name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "address", "name": "", "type": "address"}],
        "name": "blacklisted",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "uint256", "name": "id", "type": "uint256"}],
        "name": "getPackage",
        "outputs": [
            {"internalType": "uint256", "name": "price", "type": "uint256"},
            {"internalType": "uint256", "name": "taps", "type": "uint256"},
            {"internalType": "bool", "name": "active", "type": "bool"}
        ],
        "stateMutability": "view",
        "type": "function"
    },
]


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class UserInfo:
    """User information from contract and API"""
    address: str
    burner_address: Optional[str]
    taps_remaining: int
    premium_points: int
    standard_points: int
    total_points: int
    multiplier: int
    referrer: Optional[str]
    is_blacklisted: bool


@dataclass
class BurnerWallet:
    """Burner wallet data"""
    address: str
    private_key: str


# =============================================================================
# BASION BOT CLASS
# =============================================================================

class BasionBot:
    """
    Complete Basion Bot implementation.
    
    Usage:
        bot = BasionBot(private_key="0x...", proxy="http://...")
        bot.setup()  # First time only
        bot.tap_loop(count=100)
    """
    
    def __init__(
        self,
        private_key: str,
        proxy: Optional[str] = None,
        rpc_url: str = RPC_URL,
        burner_file: Optional[str] = None
    ):
        """
        Initialize Basion Bot.
        
        Args:
            private_key: Main wallet private key (0x...)
            proxy: Optional proxy URL (http://user:pass@ip:port or socks5://...)
            rpc_url: RPC endpoint URL
            burner_file: Optional file to save/load burner wallet
        """
        # Validate private key
        if not private_key.startswith("0x"):
            private_key = "0x" + private_key
        
        self.private_key = private_key
        self.proxy = proxy
        self.rpc_url = rpc_url
        
        # Create main account
        self.account = Account.from_key(private_key)
        self.address = self.account.address
        
        # Setup Web3
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        self.w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        
        # Setup contract
        self.contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(CONTRACT_ADDRESS),
            abi=CONTRACT_ABI
        )
        
        # HTTP client with proxy
        transport = None
        if proxy:
            transport = httpx.HTTPTransport(proxy=proxy)
        self.http = httpx.Client(transport=transport, timeout=30.0)
        
        # Burner wallet (loaded or created later)
        self.burner: Optional[BurnerWallet] = None
        self.burner_file = burner_file or f"burner_{self.address[:10]}.json"
        
        # Nonce management for fast taps
        self._nonce: Optional[int] = None
        
        # Gas price cache
        self._gas_price: Optional[int] = None
        self._gas_price_time: float = 0
        
        # Load existing burner if available
        self._load_burner()
        
        self._log(f"Initialized bot for {self.address[:10]}...{self.address[-6:]}")
    
    # =========================================================================
    # LOGGING
    # =========================================================================
    
    def _log(self, message: str, level: str = "INFO"):
        """Print log message with timestamp"""
        timestamp = time.strftime("%H:%M:%S")
        wallet_short = f"{self.address[:6]}...{self.address[-4:]}"
        print(f"[{timestamp}] [{wallet_short}] {message}")
    
    # =========================================================================
    # BURNER WALLET MANAGEMENT
    # =========================================================================
    
    def _load_burner(self) -> bool:
        """Load burner wallet from file if exists"""
        try:
            path = Path(self.burner_file)
            if path.exists():
                data = json.loads(path.read_text())
                self.burner = BurnerWallet(
                    address=data["address"],
                    private_key=data["private_key"]
                )
                self._log(f"Loaded burner: {self.burner.address[:10]}...")
                return True
        except Exception as e:
            self._log(f"Failed to load burner: {e}")
        return False
    
    def _save_burner(self):
        """Save burner wallet to file"""
        if self.burner:
            path = Path(self.burner_file)
            path.write_text(json.dumps({
                "address": self.burner.address,
                "private_key": self.burner.private_key
            }))
            self._log(f"Saved burner to {self.burner_file}")
    
    def create_burner(self) -> BurnerWallet:
        """Create new random burner wallet"""
        account = Account.create()
        self.burner = BurnerWallet(
            address=account.address,
            private_key=account.key.hex()
        )
        self._save_burner()
        self._log(f"Created new burner: {self.burner.address}")
        return self.burner
    
    # =========================================================================
    # SIGNATURE HELPERS
    # =========================================================================
    
    def _sign_message(self, message: str, use_burner: bool = False) -> str:
        """Sign a message with main or burner wallet"""
        key = self.burner.private_key if use_burner and self.burner else self.private_key
        msg = encode_defunct(text=message)
        signed = Account.sign_message(msg, private_key=key)
        return signed.signature.hex()
    
    def _get_timestamp(self) -> str:
        """Get current timestamp in milliseconds"""
        return str(int(time.time() * 1000))
    
    # =========================================================================
    # API METHODS
    # =========================================================================
    
    def api_get_burner(self) -> Optional[str]:
        """Check if burner exists on backend. Returns burner address or None."""
        try:
            resp = self.http.get(f"{API_BASE}/api/get-burner?wallet={self.address}")
            data = resp.json()
            if data.get("exists"):
                return data.get("burnerAddress")
        except Exception as e:
            self._log(f"API get-burner error: {e}")
        return None
    
    def api_register_burner(self) -> bool:
        """Register burner wallet with backend"""
        if not self.burner:
            raise ValueError("No burner wallet created")
        
        timestamp = self._get_timestamp()
        message = f"Register burner {self.burner.address} for {self.address} at {timestamp}"
        signature = self._sign_message(message)
        
        try:
            resp = self.http.post(
                f"{API_BASE}/api/register-burner",
                json={
                    "mainWallet": self.address,
                    "burnerWallet": self.burner.address,
                    "privateKey": self.burner.private_key,
                    "signature": signature,
                    "timestamp": timestamp
                }
            )
            data = resp.json()
            if data.get("success"):
                self._log("Registered burner with backend")
                return True
            else:
                self._log(f"Register burner failed: {data.get('error')}")
        except Exception as e:
            self._log(f"API register-burner error: {e}")
        return False
    
    def api_get_user_info(self) -> Optional[Dict[str, Any]]:
        """Get user info from API"""
        try:
            resp = self.http.get(f"{API_BASE}/api/user/{self.address}")
            return resp.json()
        except Exception as e:
            self._log(f"API user info error: {e}")
        return None
    
    def api_tap(self, count: int = 1) -> Dict[str, Any]:
        """
        Send tap via API (slower than direct contract call).
        Use this if you want server-side processing.
        """
        timestamp = self._get_timestamp()
        message = f"Basion tap for {self.address} at {timestamp}"
        signature = self._sign_message(message)
        
        resp = self.http.post(
            f"{API_BASE}/api/tap",
            json={
                "wallet": self.address,
                "signature": signature,
                "timestamp": timestamp,
                "count": count
            }
        )
        return resp.json()
    
    def api_redeem_boost(self, code: str) -> Dict[str, Any]:
        """Redeem a boost code"""
        resp = self.http.post(
            f"{API_BASE}/api/boost/redeem",
            json={
                "address": self.address,
                "code": code
            }
        )
        return resp.json()
    
    def api_get_leaderboard(self, limit: int = 100) -> list:
        """Get leaderboard"""
        resp = self.http.get(f"{API_BASE}/api/leaderboard?limit={limit}")
        return resp.json()
    
    # =========================================================================
    # CONTRACT READ METHODS
    # =========================================================================
    
    def get_user_info(self) -> UserInfo:
        """Get complete user info from contract"""
        # Get points
        premium, standard, total = self.contract.functions.getPoints(self.address).call()
        
        # Get user info
        taps, multiplier, burner = self.contract.functions.getUserInfo(self.address).call()
        
        # Get referrer
        referrer = self.contract.functions.referrer(self.address).call()
        
        # Get blacklist status
        is_blacklisted = self.contract.functions.blacklisted(self.address).call()
        
        return UserInfo(
            address=self.address,
            burner_address=burner if burner != "0x" + "0" * 40 else None,
            taps_remaining=taps,
            premium_points=premium,
            standard_points=standard,
            total_points=total,
            multiplier=multiplier,
            referrer=referrer if referrer != "0x" + "0" * 40 else None,
            is_blacklisted=is_blacklisted
        )
    
    def get_tap_balance(self) -> int:
        """Get remaining taps from contract"""
        return self.contract.functions.tapBalance(self.address).call()
    
    def get_points(self) -> Tuple[int, int, int]:
        """Get points (premium, standard, total)"""
        return self.contract.functions.getPoints(self.address).call()
    
    def get_burner_from_contract(self) -> Optional[str]:
        """Get registered burner address from contract"""
        burner = self.contract.functions.userToBurner(self.address).call()
        return burner if burner != "0x" + "0" * 40 else None
    
    def get_package_info(self, package_id: int) -> Tuple[int, int, bool]:
        """Get package info (price_wei, taps, active)"""
        return self.contract.functions.getPackage(package_id).call()
    
    # =========================================================================
    # CONTRACT WRITE METHODS
    # =========================================================================
    
    def _get_gas_price(self) -> int:
        """Get gas price with caching (30 seconds)"""
        now = time.time()
        if self._gas_price is None or now - self._gas_price_time > 30:
            self._gas_price = self.w3.eth.gas_price
            self._gas_price_time = now
        return self._gas_price
    
    def _send_tx(
        self,
        func,
        value: int = 0,
        use_burner: bool = False,
        gas_limit: int = 100000
    ) -> str:
        """Send transaction and return tx hash"""
        account = Account.from_key(
            self.burner.private_key if use_burner and self.burner else self.private_key
        )
        address = account.address
        
        # Get nonce
        nonce = self.w3.eth.get_transaction_count(address, 'pending')
        
        # Get gas price
        gas_price = self._get_gas_price()
        
        # Build transaction
        tx = func.build_transaction({
            'from': address,
            'value': value,
            'gas': gas_limit,
            'gasPrice': gas_price,
            'nonce': nonce,
            'chainId': CHAIN_ID
        })
        
        # Sign and send
        signed = self.w3.eth.account.sign_transaction(tx, account.key)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        
        return tx_hash.hex()
    
    def register_burner_on_chain(self) -> str:
        """Register burner wallet on blockchain"""
        if not self.burner:
            raise ValueError("No burner wallet created")
        
        self._log(f"Registering burner on chain...")
        tx_hash = self._send_tx(
            self.contract.functions.registerBurner(
                Web3.to_checksum_address(self.burner.address)
            ),
            gas_limit=100000
        )
        self._log(f"Register burner tx: {tx_hash}")
        
        # Wait for confirmation
        self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        self._log("Burner registered on chain!")
        return tx_hash
    
    def deposit(
        self,
        package_id: int = 1,
        referrer: Optional[str] = None
    ) -> str:
        """
        Deposit ETH to buy taps.
        
        Args:
            package_id: 0 = 5000 taps ($3), 1 = 20000 taps ($10)
            referrer: Optional referrer address
        
        Returns:
            Transaction hash
        """
        if package_id not in PACKAGES:
            raise ValueError(f"Invalid package_id: {package_id}")
        
        _, taps, eth_price = PACKAGES[package_id]
        value_wei = self.w3.to_wei(eth_price, 'ether')
        
        referrer_addr = Web3.to_checksum_address(
            referrer if referrer else "0x" + "0" * 40
        )
        
        self._log(f"Depositing {eth_price} ETH for {taps} taps...")
        tx_hash = self._send_tx(
            self.contract.functions.deposit(package_id, referrer_addr),
            value=value_wei,
            gas_limit=200000
        )
        self._log(f"Deposit tx: {tx_hash}")
        
        # Wait for confirmation
        self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        self._log(f"Deposit confirmed! +{taps} taps")
        return tx_hash
    
    def tap(self) -> str:
        """
        Perform single tap directly on contract (fastest method).
        Must be called from burner wallet.
        """
        if not self.burner:
            raise ValueError("No burner wallet. Call setup() first.")
        
        tx_hash = self._send_tx(
            self.contract.functions.tap(),
            use_burner=True,
            gas_limit=100000
        )
        return tx_hash
    
    def batch_tap(self, count: int) -> str:
        """
        Perform multiple taps in one transaction.
        
        Args:
            count: Number of taps (1-100)
        """
        if not self.burner:
            raise ValueError("No burner wallet. Call setup() first.")
        
        if count < 1 or count > 100:
            raise ValueError("Count must be 1-100")
        
        tx_hash = self._send_tx(
            self.contract.functions.batchTap(count),
            use_burner=True,
            gas_limit=100000 + (count * 5000)
        )
        return tx_hash
    
    # =========================================================================
    # FAST TAP (OPTIMIZED FOR SPEED)
    # =========================================================================
    
    def fast_tap(self) -> str:
        """
        Optimized tap with local nonce management.
        Allows ~1 tap per second without waiting for confirmation.
        """
        if not self.burner:
            raise ValueError("No burner wallet")
        
        burner_account = Account.from_key(self.burner.private_key)
        
        # Get nonce only once, then increment locally
        if self._nonce is None:
            self._nonce = self.w3.eth.get_transaction_count(
                burner_account.address, 'pending'
            )
        
        # Get cached gas price
        gas_price = self._get_gas_price()
        
        # Build transaction
        tx = self.contract.functions.tap().build_transaction({
            'from': burner_account.address,
            'gas': 100000,
            'gasPrice': gas_price,
            'nonce': self._nonce,
            'chainId': CHAIN_ID
        })
        
        # Sign and send
        signed = self.w3.eth.account.sign_transaction(tx, burner_account.key)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        
        # Increment nonce for next tx
        self._nonce += 1
        
        return tx_hash.hex()
    
    def reset_nonce(self):
        """Reset local nonce (call if transactions fail)"""
        self._nonce = None
    
    # =========================================================================
    # HIGH-LEVEL METHODS
    # =========================================================================
    
    def setup(self, package_id: int = 1, referrer: Optional[str] = None) -> bool:
        """
        Complete setup for new user:
        1. Create burner wallet (if not exists)
        2. Register burner on chain
        3. Register burner with API
        4. Make first deposit
        
        Returns True if setup successful.
        """
        self._log("Starting setup...")
        
        # Check if already has burner on chain
        on_chain_burner = self.get_burner_from_contract()
        if on_chain_burner:
            self._log(f"Already has burner on chain: {on_chain_burner}")
            # If we don't have local burner key, we can't tap
            if not self.burner:
                self._log("ERROR: Burner exists but no local key! Cannot tap.")
                return False
            return True
        
        # Create burner if not exists
        if not self.burner:
            self.create_burner()
        
        # Register on blockchain
        self.register_burner_on_chain()
        
        # Register with API
        self.api_register_burner()
        
        # Make deposit
        self.deposit(package_id=package_id, referrer=referrer)
        
        self._log("Setup complete!")
        return True
    
    def ensure_taps(self, min_taps: int = 100, package_id: int = 1):
        """Ensure we have at least min_taps available"""
        current = self.get_tap_balance()
        if current < min_taps:
            self._log(f"Low taps ({current}), depositing...")
            self.deposit(package_id=package_id)
    
    def tap_loop(
        self,
        count: Optional[int] = None,
        delay: float = 1.1,
        auto_deposit: bool = True,
        package_id: int = 1
    ):
        """
        Main tap loop.
        
        Args:
            count: Number of taps (None = infinite)
            delay: Delay between taps in seconds
            auto_deposit: Automatically deposit when out of taps
            package_id: Package to use for auto-deposit
        """
        self._log(f"Starting tap loop (count={count}, delay={delay}s)")
        
        taps_done = 0
        errors = 0
        max_errors = 10
        
        while count is None or taps_done < count:
            try:
                # Check taps every 10 taps or on error
                if taps_done % 10 == 0:
                    taps_remaining = self.get_tap_balance()
                    if taps_remaining == 0:
                        if auto_deposit:
                            self._log("Out of taps! Depositing...")
                            self.deposit(package_id=package_id)
                            self.reset_nonce()  # Reset after deposit
                        else:
                            self._log("Out of taps!")
                            break
                
                # Send tap
                tx_hash = self.fast_tap()
                taps_done += 1
                
                # Log every 10 taps
                if taps_done % 10 == 0:
                    _, _, total = self.get_points()
                    self._log(f"TAP x{taps_done} | pts: {total} | tx: {tx_hash[:10]}...")
                
                errors = 0  # Reset error counter
                
            except Exception as e:
                errors += 1
                error_msg = str(e)
                
                if "nonce" in error_msg.lower():
                    self._log("Nonce error, resetting...")
                    self.reset_nonce()
                elif "insufficient funds" in error_msg.lower():
                    self._log("ERROR: Insufficient ETH for gas!")
                    break
                elif "blacklisted" in error_msg.lower():
                    self._log("ERROR: Wallet is blacklisted!")
                    break
                else:
                    self._log(f"Error: {error_msg}")
                
                if errors >= max_errors:
                    self._log(f"Too many errors ({errors}), stopping")
                    break
            
            time.sleep(delay)
        
        self._log(f"Tap loop finished. Total taps: {taps_done}")
    
    # =========================================================================
    # UTILITY METHODS
    # =========================================================================
    
    def get_eth_balance(self, use_burner: bool = False) -> float:
        """Get ETH balance of main or burner wallet"""
        address = self.burner.address if use_burner and self.burner else self.address
        balance = self.w3.eth.get_balance(address)
        return float(self.w3.from_wei(balance, 'ether'))
    
    def print_status(self):
        """Print current status"""
        info = self.get_user_info()
        main_eth = self.get_eth_balance()
        burner_eth = self.get_eth_balance(use_burner=True) if self.burner else 0
        
        print("\n" + "=" * 50)
        print(f"Main Wallet:    {self.address}")
        print(f"Main ETH:       {main_eth:.6f} ETH")
        print(f"Burner Wallet:  {info.burner_address or 'None'}")
        print(f"Burner ETH:     {burner_eth:.6f} ETH")
        print(f"Taps Remaining: {info.taps_remaining}")
        print(f"Total Points:   {info.total_points}")
        print(f"  Premium:      {info.premium_points}")
        print(f"  Standard:     {info.standard_points}")
        print(f"Multiplier:     {info.multiplier / 100:.2f}x")
        print(f"Referrer:       {info.referrer or 'None'}")
        print(f"Blacklisted:    {info.is_blacklisted}")
        print("=" * 50 + "\n")


# =============================================================================
# MULTI-WALLET BOT
# =============================================================================

class MultiWalletBot:
    """
    Run multiple bots in parallel.
    
    Usage:
        bot = MultiWalletBot("wallets.txt")
        asyncio.run(bot.run_all())
    """
    
    def __init__(self, wallets_file: str):
        """
        Load wallets from file.
        
        File format (one per line):
        PRIVATE_KEY:PROXY
        
        Example:
        0xABC123:http://user:pass@ip:port
        0xDEF456:socks5://user:pass@ip:port
        0x789ABC:
        """
        self.bots: list[BasionBot] = []
        
        with open(wallets_file) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                
                # Split only on first colon after private key (66 chars for 0x + 64 hex)
                if line.startswith("0x"):
                    pk_end = 66
                    private_key = line[:pk_end]
                    proxy = line[pk_end + 1:] if len(line) > pk_end + 1 else None
                else:
                    # No 0x prefix
                    pk_end = 64
                    private_key = line[:pk_end]
                    proxy = line[pk_end + 1:] if len(line) > pk_end + 1 else None
                
                if proxy == "":
                    proxy = None
                
                bot = BasionBot(private_key=private_key, proxy=proxy)
                self.bots.append(bot)
        
        print(f"Loaded {len(self.bots)} wallets")
    
    async def run_bot(self, bot: BasionBot, count: Optional[int] = None):
        """Run single bot in async context"""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: bot.tap_loop(count=count))
    
    async def run_all(self, count: Optional[int] = None):
        """Run all bots in parallel"""
        tasks = [self.run_bot(bot, count) for bot in self.bots]
        await asyncio.gather(*tasks)
    
    def setup_all(self, package_id: int = 1):
        """Setup all bots (create burner, deposit)"""
        for bot in self.bots:
            try:
                bot.setup(package_id=package_id)
            except Exception as e:
                print(f"Setup failed for {bot.address}: {e}")


# =============================================================================
# MAIN ENTRY POINT
# =============================================================================

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Basion Bot SDK v1.0.0")
        print("\nUsage:")
        print("  python basion_bot.py <private_key> [proxy]")
        print("  python basion_bot.py wallets.txt")
        print("\nExamples:")
        print("  python basion_bot.py 0xABC123...")
        print("  python basion_bot.py 0xABC123... http://user:pass@ip:port")
        print("  python basion_bot.py wallets.txt")
        print("\nwallets.txt format:")
        print("  PRIVATE_KEY:PROXY")
        print("  0xABC123...:http://user:pass@ip:port")
        print("  0xDEF456...:socks5://user:pass@ip:port")
        print("  0x789ABC...:  (no proxy)")
        sys.exit(1)
    
    arg = sys.argv[1]
    
    if arg.endswith(".txt"):
        # Multi-wallet mode
        print("Multi-wallet mode")
        bot = MultiWalletBot(arg)
        
        # Setup if needed
        for b in bot.bots:
            if not b.get_burner_from_contract():
                print(f"Setting up {b.address}...")
                b.setup()
        
        asyncio.run(bot.run_all())
    else:
        # Single wallet mode
        proxy = sys.argv[2] if len(sys.argv) > 2 else None
        bot = BasionBot(private_key=arg, proxy=proxy)
        bot.print_status()
        
        # Check if setup needed
        if not bot.get_burner_from_contract():
            print("No burner registered. Running setup...")
            bot.setup()
        
        # Start tapping
        bot.tap_loop()
