# Basion API Bot - Technical Specification

## 1. API Configuration

| Parameter | Value |
|-----------|-------|
| Base URL | https://basion.app |
| Network | Base Sepolia (chainId 84532) |
| RPC URL | https://sepolia.base.org |
| Contract | 0x6bdd40883a4828DfFcE33C3A2222a0eFd31DFe1A |

## 2. API Endpoints

### POST /api/init
Creates burner wallet and returns transaction data for registration/deposit.

**Request:**
```json
{
  "wallet": "0xMainWalletAddress",
  "signature": "0x...",
  "timestamp": "1234567890123",
  "packageId": 1,
  "referrer": "0x0000000000000000000000000000000000000000"
}
```

**Signature Message:** `Basion init for {wallet} at {timestamp}`

**Response:**
```json
{
  "success": true,
  "burnerAddress": "0x...",
  "burnerCreated": true,
  "burnerRegistered": false,
  "tapBalance": 0,
  "contractAddress": "0x6bdd40883a4828DfFcE33C3A2222a0eFd31DFe1A",
  "rpcUrl": "https://sepolia.base.org",
  "chainId": 84532,
  "registerBurnerTx": {
    "to": "0x...",
    "data": "0x...",
    "value": "0"
  },
  "depositTx": {
    "to": "0x...",
    "data": "0x...",
    "value": "3000000000000000",
    "valueEth": "0.003",
    "taps": 20000
  }
}
```

### POST /api/tap
Sends tap transaction through backend.

**Request:**
```json
{
  "wallet": "0xMainWalletAddress",
  "signature": "0x...",
  "timestamp": "1234567890123",
  "count": 1
}
```

**Signature Message:** `Basion tap for {wallet} at {timestamp}`

**Response (success):**
```json
{
  "success": true,
  "txHash": "0x...",
  "count": 1,
  "burnerAddress": "0x..."
}
```

**Response (no taps):**
```json
{
  "success": false,
  "error": "No taps remaining. Please deposit more."
}
```

## 3. Package Configuration

| ID | Price (ETH) | Price (USD) | Taps |
|----|-------------|-------------|------|
| 0 | 0.001 | ~$3 | 5,000 |
| 1 | 0.003 | ~$10 | 20,000 |

**Bot uses:** Package ID 1 (20,000 taps for 0.003 ETH / ~$10)

## 4. Bot Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    BASION API BOT                           │
├─────────────────────────────────────────────────────────────┤
│  .env                                                       │
│  ├── MAIN_PRIVATE_KEY=0x...                                │
│  └── PROXY=http://user:pass@ip:port                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Bot ──────────▶ API (/api/init, /api/tap)                 │
│    │                    │                                   │
│    │                    ▼                                   │
│    │              Backend handles:                          │
│    │              • Burner creation                         │
│    │              • Burner key decryption                   │
│    │              • Tap transaction                         │
│    │                                                        │
│    └──────────▶ Blockchain (only for deposit)              │
│                 • registerBurner()                          │
│                 • deposit()                                 │
└─────────────────────────────────────────────────────────────┘
```

## 5. Bot Logic Flow

```
┌──────────────────────────────────────────────────────────┐
│                      STARTUP                              │
├──────────────────────────────────────────────────────────┤
│ 1. Load MAIN_PRIVATE_KEY from .env                       │
│ 2. Load PROXY from .env                                  │
│ 3. Call POST /api/init to check status                   │
│ 4. If tapBalance == 0 and not registered:                │
│    a. Send registerBurnerTx (from main wallet)           │
│    b. Send depositTx (from main wallet, 0.003 ETH)       │
│ 5. Start tap loop                                        │
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                    MAIN TAP LOOP                          │
├──────────────────────────────────────────────────────────┤
│ WHILE True:                                              │
│   1. POST /api/tap (count=1)                            │
│   2. IF success:                                         │
│        a. Log: "Tap success, tx: {txHash}"              │
│        b. Sleep(1.1 seconds)                            │
│   3. ELSE IF "No taps remaining":                       │
│        a. Log: "Out of taps, auto-buying..."            │
│        b. Call /api/init to get depositTx               │
│        c. Send depositTx (0.003 ETH for 20000 taps)     │
│        d. Wait for confirmation                          │
│        e. Log: "Purchased 20000 taps"                   │
│        f. Continue loop                                  │
│   4. ELSE IF "Rate limit":                              │
│        a. Wait 60 seconds                               │
│        b. Continue                                       │
│   5. Handle other errors with retry                      │
└──────────────────────────────────────────────────────────┘
```

## 6. Error Handling

| Error | Action |
|-------|--------|
| `MAINTENANCE` | **STOP BOT**, wait `retryAfter` seconds, check /api/status |
| `No taps remaining` | Auto-buy 20000 taps (deposit 0.003 ETH) |
| `Rate limit exceeded` | Wait 60 seconds, retry |
| `Insufficient gas on burner` | Deposit more (burner gets 70% of deposit) |
| `Invalid signature` | Regenerate timestamp and signature |
| `nonce too low` | Wait 2s, retry |
| Network timeout | Retry with exponential backoff |

### Maintenance Mode

When service is under maintenance, API returns:
```json
{
  "success": false,
  "error": "MAINTENANCE",
  "message": "Service is under maintenance. Please try again later.",
  "retryAfter": 3600
}
```

**Bot MUST:**
1. Stop all tapping immediately
2. Log: `[MAINTENANCE] Service under maintenance, pausing for {retryAfter}s...`
3. Wait `retryAfter` seconds
4. Check `GET /api/status` before resuming
5. Only resume when `status === "operational"`

## 7. Logging Format

```
[2024-01-22 18:30:00] [INFO] Bot started for 0x52a...
[2024-01-22 18:30:01] [INIT] Tap balance: 20000, Burner: 0x7cf...
[2024-01-22 18:30:02] [TAP] Success | tx: 0xabc... 
[2024-01-22 18:30:03] [TAP] Success | tx: 0xdef...
...
[2024-01-22 19:45:00] [TAP] Error: No taps remaining
[2024-01-22 19:45:01] [BUY] Purchasing 20000 taps for 0.003 ETH...
[2024-01-22 19:45:15] [BUY] Success | tx: 0x123...
[2024-01-22 19:45:16] [TAP] Resuming tap loop...
```

## 8. Settings

| Setting | Value | Notes |
|---------|-------|-------|
| Tap interval | 1.1 seconds | Slightly above rate limit |
| Package ID | 1 | $10 = 20000 taps |
| Auto-buy | Always ON | No balance limits |
| Proxy | 1 per wallet | For IP distribution |

## 9. Security

- Private key stored in .env (gitignored)
- Signature required for all API calls
- No burner key exposure (handled by backend)
- Proxy support for IP privacy
