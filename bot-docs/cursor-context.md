# Basion API Bot - Cursor Context

## Project Goal
Build a Python bot that farms taps on Basion dApp using ONLY the API endpoints.
No direct Supabase access, no encryption key needed.

## What the bot does
1. Loads 1 wallet private key from .env
2. Signs API requests with main wallet
3. Uses /api/init to setup (creates burner automatically)
4. Uses /api/tap to send taps (backend handles burner)
5. Auto-deposits $10 when taps run out (NO balance limits)
6. Taps every 1.1 seconds continuously

## Key Technical Details

### API Base URL
`https://basion.app` (or localhost:3000 for testing)

### Signing Messages
```python
from eth_account import Account
from eth_account.messages import encode_defunct

def sign_message(message: str, private_key: str) -> str:
    """Sign a message with the main wallet."""
    signed = Account.sign_message(
        encode_defunct(text=message),
        private_key
    )
    return signed.signature.hex()
```

### Init API Call
```python
import requests
import time

def init_user(wallet: str, private_key: str, proxy: dict) -> dict:
    """Initialize user - creates burner, returns tx data."""
    timestamp = str(int(time.time() * 1000))
    message = f"Basion init for {wallet} at {timestamp}"
    signature = sign_message(message, private_key)
    
    response = requests.post(
        f"{API_BASE}/api/init",
        json={
            "wallet": wallet,
            "signature": signature,
            "timestamp": timestamp,
            "packageId": 1,  # $10 package
            "referrer": "0x0000000000000000000000000000000000000000"
        },
        proxies=proxy,
        timeout=30
    )
    return response.json()
```

### Tap API Call
```python
def tap(wallet: str, private_key: str, proxy: dict) -> dict:
    """Send a single tap via API."""
    timestamp = str(int(time.time() * 1000))
    message = f"Basion tap for {wallet} at {timestamp}"
    signature = sign_message(message, private_key)
    
    response = requests.post(
        f"{API_BASE}/api/tap",
        json={
            "wallet": wallet,
            "signature": signature,
            "timestamp": timestamp,
            "count": 1
        },
        proxies=proxy,
        timeout=30
    )
    return response.json()
```

### Deposit Transaction
When taps run out, bot must send blockchain transaction:
```python
from web3 import Web3

def deposit(w3: Web3, account, tx_data: dict) -> str:
    """Send deposit transaction to contract."""
    tx = {
        'to': Web3.to_checksum_address(tx_data['to']),
        'data': tx_data['data'],
        'value': int(tx_data['value']),
        'gas': 200000,
        'gasPrice': w3.eth.gas_price,
        'nonce': w3.eth.get_transaction_count(account.address),
        'chainId': 84532
    }
    
    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    return tx_hash.hex()
```

### .env Structure
```env
# Main wallet private key (required)
MAIN_PRIVATE_KEY=0xYourPrivateKeyHere

# Proxy (optional but recommended)
PROXY=http://user:pass@ip:port

# API URL (default: https://basion.app)
API_BASE=https://basion.app

# Settings
TAP_DELAY=1.1
```

### Main Loop
```python
import asyncio

async def main():
    """Main bot loop."""
    # Load config
    private_key = os.getenv('MAIN_PRIVATE_KEY')
    proxy_url = os.getenv('PROXY', '')
    
    account = Account.from_key(private_key)
    wallet = account.address
    
    proxy = {'http': proxy_url, 'https': proxy_url} if proxy_url else {}
    
    # Setup Web3 for deposit transactions
    w3 = Web3(Web3.HTTPProvider('https://sepolia.base.org'))
    
    log(f"[INFO] Starting bot for {wallet}")
    
    # Initial setup
    init_result = init_user(wallet, private_key, proxy)
    if not init_result.get('success'):
        log(f"[ERROR] Init failed: {init_result.get('error')}")
        return
    
    log(f"[INIT] Burner: {init_result['burnerAddress']}")
    log(f"[INIT] Tap balance: {init_result['tapBalance']}")
    
    # If no taps and not registered, do initial setup
    if init_result['tapBalance'] == 0:
        # Register burner if needed
        if init_result.get('registerBurnerTx'):
            log("[SETUP] Registering burner...")
            tx_hash = send_transaction(w3, account, init_result['registerBurnerTx'], value=0)
            wait_for_tx(w3, tx_hash)
        
        # Deposit
        log("[SETUP] Making initial deposit...")
        tx_hash = deposit(w3, account, init_result['depositTx'])
        wait_for_tx(w3, tx_hash)
        log(f"[SETUP] Deposited, now have 20000 taps")
    
    # Main tap loop
    while True:
        try:
            result = tap(wallet, private_key, proxy)
            
            if result.get('success'):
                log(f"[TAP] Success | tx: {result.get('txHash', 'N/A')[:20]}...")
            
            elif 'No taps remaining' in result.get('error', ''):
                # AUTO-BUY - NO BALANCE LIMITS
                log("[BUY] Out of taps, auto-purchasing 20000...")
                
                # Get fresh deposit tx
                init_result = init_user(wallet, private_key, proxy)
                tx_hash = deposit(w3, account, init_result['depositTx'])
                wait_for_tx(w3, tx_hash)
                
                log(f"[BUY] Success | tx: {tx_hash}")
                continue  # Resume tapping immediately
            
            elif 'Rate limit' in result.get('error', ''):
                log("[WAIT] Rate limited, waiting 60s...")
                await asyncio.sleep(60)
                continue
            
            else:
                log(f"[ERROR] {result.get('error', 'Unknown')}")
            
            await asyncio.sleep(1.1)  # 1.1 second delay
            
        except Exception as e:
            log(f"[ERROR] {e}")
            await asyncio.sleep(5)


if __name__ == '__main__':
    asyncio.run(main())
```

### Dependencies (requirements.txt)
```
web3>=6.0.0
eth-account>=0.10.0
requests>=2.31.0
python-dotenv>=1.0.0
```

### Important Notes

1. **Taps go through API** - backend handles burner wallet
2. **Deposit goes direct to blockchain** - needs main wallet signature
3. **1.1 second delay** between taps (slightly above rate limit)
4. **Package ID 1** = 20000 taps for 0.003 ETH (~$10)
5. **NO BALANCE LIMITS** - always auto-buy when taps = 0
6. **Proxy optional** but recommended for production

### Error Messages to Handle

| Error | Meaning | Action |
|-------|---------|--------|
| `MAINTENANCE` | Service under maintenance | **STOP**, wait retryAfter, check /api/status |
| `No taps remaining` | tapBalance = 0 | Auto-deposit |
| `Rate limit exceeded` | Too many requests | Wait 60s |
| `Insufficient gas on burner` | Burner needs ETH | Deposit more |
| `Invalid signature` | Signature error | Regenerate |
| `Signature expired` | Timestamp too old | New timestamp |
| `No burner wallet found` | Need to init first | Call /api/init |

### Maintenance Mode Handling

```python
def check_status(proxy: dict) -> dict:
    """Check if service is operational."""
    response = requests.get(f"{API_BASE}/api/status", proxies=proxy, timeout=10)
    return response.json()

# In main loop:
if result.get('error') == 'MAINTENANCE':
    retry_after = result.get('retryAfter', 3600)
    log(f"[MAINTENANCE] Service under maintenance, pausing for {retry_after}s...")
    time.sleep(retry_after)
    
    # Check status before resuming
    while True:
        status = check_status(proxy)
        if status.get('status') == 'operational':
            log("[MAINTENANCE] Service restored, resuming...")
            break
        log("[MAINTENANCE] Still under maintenance, waiting 60s...")
        time.sleep(60)
    
    continue  # Resume tap loop
```
