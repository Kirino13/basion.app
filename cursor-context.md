# Basion Multi-Wallet Bot - Cursor Context

## Project Goal

Создать Python бота который:
- Загружает до **10 кошельков** из wallets.txt
- Для каждого кошелька запускает отдельный async worker
- Автоматически создаёт burner если его нет
- Автоматически делает deposit $10 когда тапы закончились
- Тапает бесконечно (1.1 сек между тапами)

## Input Format

**wallets.txt** - единственный файл ввода:
```
# PRIVATE_KEY:PROXY
0xABC123...DEF456:http://user:pass@ip:port
0x789DEF...123ABC:socks5://user:pass@ip:port
0xDEF456...ABC789:
```

## Key Technical Details

### Constants
```python
CHAIN_ID = 84532  # Base Sepolia
RPC_URL = "https://sepolia.base.org"
CONTRACT_ADDRESS = "0x6bdd40883a4828DfFcE33C3A2222a0eFd31DFe1A"
API_BASE = "https://basion.app"
PACKAGE_ID = 1  # $10 package = 20000 taps
DEPOSIT_VALUE = 0.003  # ETH (~$10)
TAP_DELAY = 1.1  # seconds
```

### Contract ABI (минимальный)
```python
CONTRACT_ABI = [
    {
        "inputs": [{"name": "burner", "type": "address"}],
        "name": "registerBurner",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {"name": "packageId", "type": "uint8"},
            {"name": "referrer", "type": "address"}
        ],
        "name": "deposit",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [{"name": "user", "type": "address"}],
        "name": "tapBalance",
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    }
]
```

### Signing Messages
```python
from eth_account import Account
from eth_account.messages import encode_defunct

def sign_message(message: str, private_key: str) -> str:
    """Sign a message with wallet."""
    signed = Account.sign_message(
        encode_defunct(text=message),
        private_key
    )
    return signed.signature.hex()
```

### Check Burner Exists
```python
import httpx

async def check_burner(wallet: str, proxy: str | None) -> dict:
    """Check if user has a burner wallet."""
    proxies = {"http://": proxy, "https://": proxy} if proxy else None
    
    async with httpx.AsyncClient(proxies=proxies, timeout=30) as client:
        response = await client.get(
            f"{API_BASE}/api/get-burner",
            params={"wallet": wallet}
        )
        return response.json()
    
# Response: {"exists": true, "burnerAddress": "0x..."} или {"exists": false}
```

### Get User Status
```python
async def get_user_status(wallet: str, proxy: str | None) -> dict:
    """Get user's tap balance and points."""
    proxies = {"http://": proxy, "https://": proxy} if proxy else None
    
    async with httpx.AsyncClient(proxies=proxies, timeout=30) as client:
        response = await client.get(f"{API_BASE}/api/user/{wallet}")
        return response.json()

# Response: {"tapsRemaining": 15420, "totalPoints": 4580, ...}
```

### Create Burner Wallet Locally
```python
def create_burner_wallet() -> tuple[str, str]:
    """Generate new burner keypair locally."""
    account = Account.create()
    return account.address, account.key.hex()
```

### Register Burner on Blockchain
```python
from web3 import Web3

def register_burner_blockchain(
    w3: Web3,
    main_account,
    burner_address: str
) -> str:
    """Call registerBurner on contract."""
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(CONTRACT_ADDRESS),
        abi=CONTRACT_ABI
    )
    
    tx = contract.functions.registerBurner(
        Web3.to_checksum_address(burner_address)
    ).build_transaction({
        'from': main_account.address,
        'gas': 100000,
        'gasPrice': w3.eth.gas_price,
        'nonce': w3.eth.get_transaction_count(main_account.address),
        'chainId': CHAIN_ID
    })
    
    signed = main_account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    return tx_hash.hex()
```

### Deposit on Blockchain
```python
def deposit_blockchain(
    w3: Web3,
    main_account,
    package_id: int = 1
) -> str:
    """Deposit ETH to buy taps."""
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(CONTRACT_ADDRESS),
        abi=CONTRACT_ABI
    )
    
    tx = contract.functions.deposit(
        package_id,
        "0x0000000000000000000000000000000000000000"  # no referrer
    ).build_transaction({
        'from': main_account.address,
        'value': Web3.to_wei(DEPOSIT_VALUE, 'ether'),
        'gas': 200000,
        'gasPrice': w3.eth.gas_price,
        'nonce': w3.eth.get_transaction_count(main_account.address),
        'chainId': CHAIN_ID
    })
    
    signed = main_account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    return tx_hash.hex()
```

### Register Burner in Backend
```python
import time

async def register_burner_backend(
    wallet: str,
    burner_address: str,
    burner_private_key: str,
    main_private_key: str,
    proxy: str | None
) -> dict:
    """Register burner in backend database."""
    timestamp = str(int(time.time() * 1000))
    message = f"Register burner {burner_address} for {wallet} at {timestamp}"
    signature = sign_message(message, main_private_key)
    
    proxies = {"http://": proxy, "https://": proxy} if proxy else None
    
    async with httpx.AsyncClient(proxies=proxies, timeout=30) as client:
        response = await client.post(
            f"{API_BASE}/api/register-burner",
            json={
                "mainWallet": wallet,
                "burnerWallet": burner_address,
                "privateKey": burner_private_key,
                "signature": signature,
                "timestamp": timestamp
            }
        )
        return response.json()
```

### Send Tap via API
```python
async def send_tap(
    wallet: str,
    private_key: str,
    proxy: str | None,
    count: int = 1
) -> dict:
    """Send tap through API."""
    timestamp = str(int(time.time() * 1000))
    message = f"Basion tap for {wallet} at {timestamp}"
    signature = sign_message(message, private_key)
    
    proxies = {"http://": proxy, "https://": proxy} if proxy else None
    
    async with httpx.AsyncClient(proxies=proxies, timeout=30) as client:
        response = await client.post(
            f"{API_BASE}/api/tap",
            json={
                "wallet": wallet,
                "signature": signature,
                "timestamp": timestamp,
                "count": count
            }
        )
        return response.json()

# Success: {"success": true, "txHash": "0x...", "points": {...}}
# No taps: {"success": false, "error": "No taps remaining..."}
```

### Wallet Worker (Main Logic)
```python
async def wallet_worker(
    private_key: str,
    proxy: str | None,
    w3: Web3
):
    """Main worker for a single wallet."""
    account = Account.from_key(private_key)
    wallet = account.address
    short = wallet[:6] + "..."
    
    log(f"[{short}] Starting worker...")
    
    # 1. Check if burner exists
    burner_info = await check_burner(wallet, proxy)
    
    if not burner_info.get("exists"):
        log(f"[{short}] No burner found, creating...")
        
        # Create new burner locally
        burner_address, burner_private_key = create_burner_wallet()
        log(f"[{short}] Generated burner: {burner_address[:10]}...")
        
        # Register on blockchain
        log(f"[{short}] Registering on blockchain...")
        tx_hash = register_burner_blockchain(w3, account, burner_address)
        await wait_for_tx(w3, tx_hash)
        log(f"[{short}] Registered! tx: {tx_hash[:20]}...")
        
        # Deposit $10
        log(f"[{short}] Depositing $10...")
        tx_hash = deposit_blockchain(w3, account)
        await wait_for_tx(w3, tx_hash)
        log(f"[{short}] Deposited! tx: {tx_hash[:20]}...")
        
        # Register in backend
        log(f"[{short}] Registering burner in backend...")
        result = await register_burner_backend(
            wallet, burner_address, burner_private_key, private_key, proxy
        )
        if not result.get("success"):
            log(f"[{short}] WARNING: Backend registration failed")
        
        log(f"[{short}] Setup complete! +20000 taps")
    
    else:
        log(f"[{short}] Burner exists: {burner_info['burnerAddress'][:10]}...")
        
        # Check tap balance
        user_info = await get_user_status(wallet, proxy)
        taps = user_info.get("tapsRemaining", 0)
        
        if taps == 0:
            log(f"[{short}] No taps, depositing $10...")
            tx_hash = deposit_blockchain(w3, account)
            await wait_for_tx(w3, tx_hash)
            log(f"[{short}] Deposited! +20000 taps")
        else:
            log(f"[{short}] Taps: {taps} | Ready to tap!")
    
    # 2. Main tap loop
    while True:
        try:
            result = await send_tap(wallet, private_key, proxy)
            
            if result.get("success"):
                pts = result.get("points", {})
                log(f"[{short}] TAP ok | pts: {pts.get('totalPoints', '?')} | taps: {pts.get('tapBalance', '?')}")
            
            elif "No taps remaining" in result.get("error", ""):
                log(f"[{short}] Out of taps! Depositing $10...")
                tx_hash = deposit_blockchain(w3, account)
                await wait_for_tx(w3, tx_hash)
                log(f"[{short}] Deposited! +20000 taps | Resuming...")
                continue
            
            elif "Rate limit" in result.get("error", ""):
                log(f"[{short}] Rate limited, waiting 60s...")
                await asyncio.sleep(60)
                continue
            
            elif "banned" in result.get("error", "").lower():
                log(f"[{short}] BANNED! Stopping worker.")
                return
            
            else:
                log(f"[{short}] Error: {result.get('error', 'Unknown')}")
            
            await asyncio.sleep(TAP_DELAY)
            
        except Exception as e:
            log(f"[{short}] Exception: {e}")
            await asyncio.sleep(5)
```

### Main Entry Point
```python
import asyncio

def load_wallets(filename: str = "wallets.txt") -> list[tuple[str, str | None]]:
    """Load wallets from file. Returns [(private_key, proxy), ...]"""
    wallets = []
    
    with open(filename, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            
            if ':' in line:
                parts = line.split(':', 1)
                private_key = parts[0].strip()
                proxy = parts[1].strip() if len(parts) > 1 and parts[1].strip() else None
            else:
                private_key = line.strip()
                proxy = None
            
            if private_key.startswith('0x') and len(private_key) == 66:
                wallets.append((private_key, proxy))
    
    return wallets[:10]  # Max 10 wallets


async def main():
    """Main bot entry point."""
    log("[INFO] Basion Bot v1.0 starting...")
    
    wallets = load_wallets("wallets.txt")
    if not wallets:
        log("[ERROR] No wallets found in wallets.txt")
        return
    
    log(f"[INFO] Loaded {len(wallets)} wallet(s)")
    
    # Create Web3 instance
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    
    if not w3.is_connected():
        log("[ERROR] Cannot connect to RPC")
        return
    
    # Start workers
    tasks = []
    for private_key, proxy in wallets:
        task = asyncio.create_task(wallet_worker(private_key, proxy, w3))
        tasks.append(task)
    
    # Wait for all workers
    await asyncio.gather(*tasks, return_exceptions=True)


if __name__ == "__main__":
    asyncio.run(main())
```

### Helper Functions
```python
import asyncio
from datetime import datetime

def log(message: str):
    """Log with timestamp."""
    now = datetime.now().strftime("%H:%M:%S")
    print(f"[{now}] {message}")


async def wait_for_tx(w3: Web3, tx_hash: str, timeout: int = 120):
    """Wait for transaction confirmation."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            receipt = w3.eth.get_transaction_receipt(tx_hash)
            if receipt:
                if receipt['status'] == 1:
                    return receipt
                else:
                    raise Exception("Transaction failed")
        except:
            pass
        await asyncio.sleep(2)
    raise Exception("Transaction timeout")
```

### requirements.txt
```
web3>=6.0.0
eth-account>=0.10.0
httpx[socks]>=0.25.0
```

## Error Messages Reference

| Error | Meaning | Action |
|-------|---------|--------|
| `No taps remaining` | tapBalance = 0 | Deposit $10 |
| `No burner wallet found` | Burner not in DB | Create + register |
| `Rate limit exceeded` | Too many requests | Wait 60s |
| `Insufficient gas on burner` | Burner out of ETH | Deposit more |
| `Wallet is banned` | Blacklisted | Stop worker |
| `Invalid signature` | Bad signature | Re-sign |
| `Signature expired` | Old timestamp | New timestamp |

## Important Notes

1. **Burner создаётся ЛОКАЛЬНО** - генерируем keypair сами
2. **RegisterBurner** - регистрирует burner в контракте
3. **Deposit** - 70% ETH идёт на burner для газа
4. **API /api/tap** - сервер использует зашифрованный burner key
5. **Нет лимитов** - бот будет депозитить пока есть ETH на main wallet
