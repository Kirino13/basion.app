# Basion Multi-Wallet Bot - Technical Specification

## 1. Overview

Автоматический бот для фарма тапов на Basion.app.
- Поддержка **до 10 кошельков** одновременно
- Ввод: только приватники + прокси
- Автоматическое создание burner wallet если нет
- Автоматический deposit $10 когда тапы закончились
- Бесконечный цикл тапов

## 2. API Configuration

| Parameter | Value |
|-----------|-------|
| Base URL | `https://basion.app` |
| Network | Base Sepolia (chainId 84532) |
| RPC URL | `https://sepolia.base.org` |
| Contract | `0x6bdd40883a4828DfFcE33C3A2222a0eFd31DFe1A` |

## 3. Существующие API Endpoints

### GET /api/get-burner?wallet=0x...
Проверяет есть ли у пользователя burner wallet.

**Response (есть burner):**
```json
{
  "exists": true,
  "burnerAddress": "0x..."
}
```

**Response (нет burner):**
```json
{
  "exists": false
}
```

### GET /api/user/{address}
Получает данные пользователя (тапы, поинты).

**Response:**
```json
{
  "mainWallet": "0x...",
  "burnerWallet": "0x...",
  "tapsRemaining": 19500,
  "premiumPoints": 500,
  "standardPoints": 0,
  "totalPoints": 500,
  "pointsMultiplier": 100,
  "isBlacklisted": false
}
```

### POST /api/register-burner
Регистрирует созданный burner в базе данных (после депозита).

**Request:**
```json
{
  "mainWallet": "0x...",
  "burnerWallet": "0x...",
  "privateKey": "0x...",
  "signature": "0x...",
  "timestamp": "1234567890123"
}
```

**Signature Message:** `Register burner {burnerWallet} for {mainWallet} at {timestamp}`

**Response:**
```json
{
  "success": true
}
```

### POST /api/tap
Отправляет тапы через бекенд (burner подписывает на сервере).

**Request:**
```json
{
  "wallet": "0x...",
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
  "burnerAddress": "0x...",
  "points": {
    "premium": 501,
    "standard": 0,
    "tapBalance": 19499,
    "totalPoints": 501
  }
}
```

**Response (no taps):**
```json
{
  "success": false,
  "error": "No taps remaining. Please deposit more."
}
```

### POST /api/sync-deposit
Синхронизирует депозит в базе.

**Request:**
```json
{
  "wallet": "0x...",
  "usdAmount": 10,
  "_token": "your-sync-token"
}
```

## 4. Contract ABI (для депозита)

```solidity
function deposit(uint8 packageId, address referrer) external payable
function registerBurner(address burner) external
function tapBalance(address user) external view returns (uint256)
function getPoints(address user) external view returns (uint256 premium, uint256 standard)
```

## 5. Package Configuration

| ID | Price (ETH) | Price (USD) | Taps |
|----|-------------|-------------|------|
| 0 | ~0.001 | ~$3 | 5,000 |
| 1 | ~0.003 | ~$10 | 20,000 |

**Бот использует:** Package ID 1 (~$10 = 20,000 taps)

## 6. Bot Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                BASION MULTI-WALLET BOT                          │
├─────────────────────────────────────────────────────────────────┤
│  wallets.txt (до 10 строк)                                      │
│  ├── PRIVATE_KEY_1:PROXY_1                                      │
│  ├── PRIVATE_KEY_2:PROXY_2                                      │
│  └── ...                                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐                                           │
│  │   Wallet Worker 1 │───┐                                      │
│  └──────────────────┘   │                                       │
│  ┌──────────────────┐   │    ┌─────────────────┐               │
│  │   Wallet Worker 2 │───┼───▶│   Basion API    │               │
│  └──────────────────┘   │    └─────────────────┘               │
│  ┌──────────────────┐   │              │                        │
│  │   ...             │───┘              ▼                        │
│  └──────────────────┘          ┌─────────────────┐              │
│                                │   Blockchain    │              │
│                                │   (deposit)     │              │
│                                └─────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

## 7. Bot Logic Flow (Per Wallet)

```
┌──────────────────────────────────────────────────────────────────┐
│                      WALLET STARTUP                               │
├──────────────────────────────────────────────────────────────────┤
│ 1. Загрузить private key и proxy из wallets.txt                  │
│ 2. Получить адрес кошелька из приватника                         │
│ 3. Вызвать GET /api/get-burner?wallet={address}                  │
│                                                                  │
│ ЕСЛИ burner НЕ существует:                                       │
│   a. Создать новый burner локально (генерация keypair)           │
│   b. Отправить registerBurner(burner) транзакцию в контракт      │
│   c. Отправить deposit(1, 0x0) с 0.003 ETH                       │
│   d. Вызвать POST /api/register-burner для сохранения в базе     │
│   e. Перейти к tap loop                                          │
│                                                                  │
│ ЕСЛИ burner СУЩЕСТВУЕТ:                                          │
│   a. Вызвать GET /api/user/{address} для проверки tapsRemaining  │
│   b. ЕСЛИ tapsRemaining > 0 → сразу tap loop                     │
│   c. ЕСЛИ tapsRemaining == 0 → сделать deposit → tap loop        │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                        MAIN TAP LOOP                              │
├──────────────────────────────────────────────────────────────────┤
│ WHILE True:                                                      │
│   1. POST /api/tap (count=1)                                     │
│   2. IF success:                                                 │
│        a. Log: "[WALLET_SHORT] TAP ok | pts: X | taps: Y"        │
│        b. Sleep(1.1 seconds)                                     │
│   3. ELSE IF "No taps remaining":                                │
│        a. Log: "[WALLET_SHORT] Out of taps, depositing $10..."   │
│        b. Отправить deposit(1, 0x0) с 0.003 ETH                  │
│        c. Дождаться confirmation                                 │
│        d. Log: "[WALLET_SHORT] Deposited! +20000 taps"           │
│        e. Continue loop                                          │
│   4. ELSE IF "Rate limit":                                       │
│        a. Wait 60 seconds                                        │
│        b. Continue                                               │
│   5. Handle other errors with retry                              │
└──────────────────────────────────────────────────────────────────┘
```

## 8. Deposit Transaction (Blockchain)

Когда тапы заканчиваются, бот отправляет транзакцию напрямую в контракт:

```python
# Contract call
contract.functions.deposit(
    1,  # packageId = 1 ($10)
    "0x0000000000000000000000000000000000000000"  # referrer
).build_transaction({
    'from': account.address,
    'value': Web3.to_wei(0.003, 'ether'),  # ~$10 at current ETH price
    'gas': 200000,
    'gasPrice': w3.eth.gas_price,
    'nonce': w3.eth.get_transaction_count(account.address),
    'chainId': 84532
})
```

## 9. Error Handling

| Error | Action |
|-------|--------|
| `No taps remaining` | Auto-buy 20000 taps (deposit ~0.003 ETH) |
| `No burner wallet found` | Create burner + register + deposit |
| `Rate limit exceeded` | Wait 60 seconds, retry |
| `Insufficient gas on burner` | Burner gets 70% of deposit ETH |
| `Invalid signature` | Regenerate timestamp and signature |
| `Wallet is banned` | Skip this wallet, log error |
| `nonce too low` | Wait 2s, retry |
| Network timeout | Retry with exponential backoff |

## 10. Input File Format (wallets.txt)

```
# Формат: PRIVATE_KEY:PROXY
# PROXY опционален - можно оставить пустым после :

0xABC123...DEF:http://user:pass@ip:port
0x123456...789:socks5://user:pass@ip:port
0xDEF789...ABC:
```

## 11. Logging Format

```
[2024-01-22 18:30:00] [INFO] Starting Basion Bot with 3 wallets...
[2024-01-22 18:30:00] [0x52a...] Checking burner status...
[2024-01-22 18:30:01] [0x52a...] Burner exists: 0x7cf...
[2024-01-22 18:30:01] [0x52a...] Taps remaining: 15420
[2024-01-22 18:30:02] [0x52a...] TAP ok | pts: 4580 | taps: 15419
[2024-01-22 18:30:03] [0x52a...] TAP ok | pts: 4581 | taps: 15418
...
[2024-01-22 20:15:00] [0x52a...] No taps remaining!
[2024-01-22 20:15:01] [0x52a...] Depositing $10 (0.003 ETH)...
[2024-01-22 20:15:15] [0x52a...] Deposit confirmed | tx: 0x123...
[2024-01-22 20:15:16] [0x52a...] +20000 taps! Resuming...
```

## 12. Settings

| Setting | Value | Notes |
|---------|-------|-------|
| Max wallets | 10 | Параллельные workers |
| Tap interval | 1.1 sec | Защита от rate limit |
| Package ID | 1 | $10 = 20000 taps |
| Auto-buy | Always ON | Нет лимитов баланса |
| Proxy | Per wallet | Для распределения IP |
| Tap count | 1 | Один тап за раз |

## 13. Security Notes

- Приватные ключи хранятся только в wallets.txt (gitignore!)
- Signature требуется для всех API вызовов
- Burner key шифруется на сервере
- Proxy рекомендуется для каждого кошелька
