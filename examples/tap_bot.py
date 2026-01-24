"""
Basion Tap Bot - Complete Python Script
========================================

This script allows you to fully automate Basion dApp:
1. Initialize (create burner wallet)
2. Register burner in contract
3. Deposit ETH for taps
4. Auto-tap

Requirements:
    pip install web3 eth-account requests

Usage:
    1. Set MAIN_WALLET and MAIN_PRIVATE_KEY below
    2. Run: python tap_bot.py

"""

import requests
import time
from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_defunct

# ============ CONFIGURATION ============
# Your main wallet address (the one you connect to Basion)
MAIN_WALLET = "0xYourMainWalletAddress"

# Your main wallet private key (KEEP SECRET!)
MAIN_PRIVATE_KEY = "0xYourPrivateKey"

# API endpoint (change to localhost:3000 for local testing)
API_BASE = "https://basion.app"

# Package: 0 = $3 (5000 taps), 1 = $10 (20000 taps)
PACKAGE_ID = 0

# Optional referrer wallet
REFERRER = "0x0000000000000000000000000000000000000000"

# Tap settings
TAPS_PER_REQUEST = 1  # 1-100 taps per request
DELAY_BETWEEN_TAPS = 1.0  # seconds between requests


# ============ HELPER FUNCTIONS ============
def sign_message(message: str) -> str:
    """Sign a message with main wallet"""
    signed = Account.sign_message(
        encode_defunct(text=message),
        MAIN_PRIVATE_KEY
    )
    return signed.signature.hex()


def init_user() -> dict:
    """
    Initialize user - creates burner wallet and returns transaction data.
    Returns dict with burnerAddress, registerBurnerTx, depositTx
    """
    timestamp = str(int(time.time() * 1000))
    message = f"Basion init for {MAIN_WALLET} at {timestamp}"
    signature = sign_message(message)
    
    response = requests.post(f"{API_BASE}/api/init", json={
        "wallet": MAIN_WALLET,
        "signature": signature,
        "timestamp": timestamp,
        "packageId": PACKAGE_ID,
        "referrer": REFERRER
    }, timeout=30)
    
    return response.json()


def send_transaction(w3: Web3, tx_data: dict, value: int = 0) -> str:
    """
    Sign and send a transaction.
    Returns transaction hash.
    """
    account = Account.from_key(MAIN_PRIVATE_KEY)
    
    # Build transaction
    tx = {
        'to': Web3.to_checksum_address(tx_data['to']),
        'data': tx_data['data'],
        'value': value,
        'gas': 200000,
        'gasPrice': w3.eth.gas_price,
        'nonce': w3.eth.get_transaction_count(account.address),
        'chainId': 84532  # Base Sepolia
    }
    
    # Sign and send
    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    
    return tx_hash.hex()


def wait_for_tx(w3: Web3, tx_hash: str, timeout: int = 120) -> bool:
    """Wait for transaction to be mined"""
    print(f"    Waiting for tx: {tx_hash[:20]}...")
    try:
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=timeout)
        if receipt['status'] == 1:
            print(f"    Confirmed in block {receipt['blockNumber']}")
            return True
        else:
            print(f"    Transaction failed!")
            return False
    except Exception as e:
        print(f"    Timeout or error: {e}")
        return False


def tap(count: int = 1) -> dict:
    """Send a tap request to Basion API"""
    timestamp = str(int(time.time() * 1000))
    message = f"Basion tap for {MAIN_WALLET} at {timestamp}"
    signature = sign_message(message)
    
    response = requests.post(f"{API_BASE}/api/tap", json={
        "wallet": MAIN_WALLET,
        "signature": signature,
        "timestamp": timestamp,
        "count": count
    }, timeout=30)
    
    return response.json()


def get_boost() -> dict:
    """Get current boost percentage"""
    response = requests.get(
        f"{API_BASE}/api/boost",
        params={"address": MAIN_WALLET},
        timeout=10
    )
    return response.json()


def redeem_boost(code: str) -> dict:
    """
    Redeem a boost code.
    Returns: {"ok": true, "boostPercent": 20, "addedBoost": 20} on success
    """
    timestamp = str(int(time.time() * 1000))
    message = f"Basion redeem boost for {MAIN_WALLET} at {timestamp}"
    signature = sign_message(message)
    
    response = requests.post(f"{API_BASE}/api/boost/redeem", json={
        "address": MAIN_WALLET,
        "code": code,
        "signature": signature,
        "timestamp": timestamp
    }, timeout=30)
    
    return response.json()


def get_stats() -> dict:
    """Get user stats (points, taps, etc.)"""
    timestamp = str(int(time.time() * 1000))
    message = f"Basion init for {MAIN_WALLET} at {timestamp}"
    signature = sign_message(message)
    
    response = requests.post(f"{API_BASE}/api/init", json={
        "wallet": MAIN_WALLET,
        "signature": signature,
        "timestamp": timestamp
    }, timeout=30)
    
    return response.json()


# ============ MAIN WORKFLOW ============
def setup():
    """
    Full setup: init → register → deposit
    Only needs to be done once per wallet.
    """
    print("=" * 60)
    print("BASION BOT - SETUP")
    print("=" * 60)
    print(f"Wallet: {MAIN_WALLET}")
    print(f"Package: {PACKAGE_ID}")
    print()
    
    # Step 1: Initialize
    print("[1/3] Initializing...")
    init_result = init_user()
    
    if not init_result.get('success'):
        print(f"ERROR: {init_result.get('error', 'Unknown error')}")
        return False
    
    print(f"    Burner: {init_result['burnerAddress']}")
    print(f"    Created: {init_result['burnerCreated']}")
    print(f"    Registered: {init_result['burnerRegistered']}")
    print(f"    Tap balance: {init_result['tapBalance']}")
    
    # If already has taps, skip setup
    if init_result['tapBalance'] > 0:
        print(f"\n[OK] Already setup! You have {init_result['tapBalance']} taps.")
        return True
    
    # Connect to Base Sepolia
    rpc_url = init_result['rpcUrl']
    w3 = Web3(Web3.HTTPProvider(rpc_url))
    
    if not w3.is_connected():
        print("ERROR: Cannot connect to RPC")
        return False
    
    print(f"    Connected to chain {w3.eth.chain_id}")
    
    # Check ETH balance
    balance = w3.eth.get_balance(MAIN_WALLET)
    balance_eth = w3.from_wei(balance, 'ether')
    print(f"    Main wallet balance: {balance_eth} ETH")
    
    deposit_value = int(init_result['depositTx']['value'])
    if balance < deposit_value + w3.to_wei(0.001, 'ether'):  # + gas buffer
        print(f"ERROR: Insufficient balance. Need at least {init_result['depositTx']['valueEth']} ETH + gas")
        return False
    
    # Step 2: Register burner (if needed)
    if init_result['registerBurnerTx']:
        print("\n[2/3] Registering burner in contract...")
        try:
            tx_hash = send_transaction(w3, init_result['registerBurnerTx'], value=0)
            if not wait_for_tx(w3, tx_hash):
                print("ERROR: registerBurner failed")
                return False
        except Exception as e:
            print(f"ERROR: {e}")
            return False
    else:
        print("\n[2/3] Burner already registered, skipping...")
    
    # Step 3: Deposit
    print(f"\n[3/3] Depositing {init_result['depositTx']['valueEth']} ETH for {init_result['depositTx']['taps']} taps...")
    try:
        tx_hash = send_transaction(w3, init_result['depositTx'], value=deposit_value)
        if not wait_for_tx(w3, tx_hash):
            print("ERROR: deposit failed")
            return False
    except Exception as e:
        print(f"ERROR: {e}")
        return False
    
    print("\n" + "=" * 60)
    print("SETUP COMPLETE!")
    print(f"You now have {init_result['depositTx']['taps']} taps available.")
    print("=" * 60)
    return True


def run_tapper():
    """Main tapping loop"""
    print("\n" + "=" * 60)
    print("BASION BOT - TAPPING")
    print("=" * 60)
    print(f"Taps per request: {TAPS_PER_REQUEST}")
    print(f"Delay: {DELAY_BETWEEN_TAPS}s")
    print("Press Ctrl+C to stop")
    print()
    
    total_taps = 0
    errors = 0
    
    try:
        while True:
            try:
                result = tap(TAPS_PER_REQUEST)
                
                if result.get("success"):
                    total_taps += TAPS_PER_REQUEST
                    tx_short = result.get('txHash', 'N/A')[:20]
                    print(f"[OK] Tap #{total_taps} | tx: {tx_short}...")
                else:
                    errors += 1
                    error_msg = result.get("error", "Unknown error")
                    print(f"[ERROR] {error_msg}")
                    
                    if "No taps remaining" in error_msg:
                        print("\n[!] Out of taps! Run setup() again to deposit more.")
                        break
                    elif "Rate limit" in error_msg:
                        print("[!] Rate limited, waiting 60s...")
                        time.sleep(60)
                    elif "Insufficient gas" in error_msg:
                        print("[!] Burner out of gas! Deposit more via dApp or run setup().")
                        break
                    elif "No burner wallet found" in error_msg:
                        print("[!] No burner found! Run setup() first.")
                        break
                        
            except requests.exceptions.Timeout:
                errors += 1
                print("[ERROR] Request timeout, retrying...")
            except requests.exceptions.RequestException as e:
                errors += 1
                print(f"[ERROR] Request failed: {e}")
            
            time.sleep(DELAY_BETWEEN_TAPS)
            
    except KeyboardInterrupt:
        print("\n\nStopped by user")
    
    print("=" * 60)
    print(f"Session complete! Total taps: {total_taps}, Errors: {errors}")
    print("=" * 60)


def show_stats():
    """Display user stats"""
    print("\n" + "=" * 60)
    print("BASION BOT - STATS")
    print("=" * 60)
    
    # Get init data (includes tap balance)
    stats = get_stats()
    if stats.get('success'):
        print(f"Burner: {stats.get('burnerAddress', 'N/A')}")
        print(f"Tap balance: {stats.get('tapBalance', 0)}")
        print(f"Burner registered: {stats.get('burnerRegistered', False)}")
    
    # Get boost
    boost = get_boost()
    print(f"Boost: {boost.get('boostPercent', 0)}%")
    print(f"Total points: {boost.get('totalPoints', 0)}")
    
    print("=" * 60)


def redeem_boost_interactive():
    """Interactive boost redemption"""
    print("\n" + "=" * 60)
    print("BASION BOT - REDEEM BOOST")
    print("=" * 60)
    
    # Show current boost
    boost = get_boost()
    print(f"Current boost: {boost.get('boostPercent', 0)}%")
    print()
    
    code = input("Enter boost code: ").strip()
    if not code:
        print("Cancelled")
        return
    
    print(f"Redeeming code: {code}...")
    result = redeem_boost(code)
    
    if result.get('ok'):
        print(f"[OK] Boost added: +{result.get('addedBoost', 0)}%")
        print(f"     New total: {result.get('boostPercent', 0)}%")
    else:
        error = result.get('error', 'Unknown error')
        error_messages = {
            'INVALID_CODE': 'Invalid boost code',
            'CODE_ALREADY_USED': 'You already used this code',
            'RATE_LIMIT': 'Too many attempts, wait a minute',
            'SIGNATURE_EXPIRED': 'Signature expired, try again',
        }
        print(f"[ERROR] {error_messages.get(error, error)}")
    
    print("=" * 60)


def main():
    """Main entry point"""
    # Validate config
    if MAIN_WALLET == "0xYourMainWalletAddress" or MAIN_PRIVATE_KEY == "0xYourPrivateKey":
        print("ERROR: Please set your MAIN_WALLET and MAIN_PRIVATE_KEY!")
        return
    
    print("\nBasion Bot - Choose action:")
    print("  1. Setup (create burner + deposit)")
    print("  2. Tap (start tapping)")
    print("  3. Full (setup + tap)")
    print("  4. Stats (view points & boost)")
    print("  5. Boost (redeem boost code)")
    print()
    
    choice = input("Enter choice (1-5): ").strip()
    
    if choice == "1":
        setup()
    elif choice == "2":
        run_tapper()
    elif choice == "3":
        if setup():
            time.sleep(2)  # Wait for blockchain to update
            run_tapper()
    elif choice == "4":
        show_stats()
    elif choice == "5":
        redeem_boost_interactive()
    else:
        print("Invalid choice")


if __name__ == "__main__":
    main()
