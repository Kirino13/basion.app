# Basion Multi-Wallet Bot - Project Manifest

## Overview

Python бот для автоматического фарма тапов на Basion.app.
- **До 10 кошельков** одновременно
- **Минимальный ввод:** только приватники + прокси
- **Полная автоматизация:** deposit → tap → repeat

## Core Features

1. **Multi-wallet support** - до 10 кошельков параллельно
2. **Auto burner creation** - если нет burner → создаёт автоматически
3. **Auto deposit** - когда тапы = 0 → автоматически докупает $10
4. **Proxy support** - каждый кошелёк со своим прокси
5. **Zero config** - только wallets.txt

## Tech Stack

| Component | Technology |
|-----------|------------|
| Language | Python 3.11+ |
| HTTP Client | httpx (async) или requests |
| Blockchain | web3.py |
| Signing | eth-account |
| Async | asyncio |

## Project Structure

```
basion-bot/
├── wallets.txt          # Приватники + прокси (до 10 строк)
├── main.py              # Основной файл бота
├── requirements.txt     # Зависимости
└── logs/                # Логи (auto-created)
    └── bot_2024-01-22.log
```

## wallets.txt Format

```
# PRIVATE_KEY:PROXY (proxy опционален)

0xABC123...DEF:http://user:pass@ip:port
0x123456...789:socks5://user:pass@ip:port
0xDEF789...ABC:
```

**Примеры прокси:**
- HTTP: `http://user:pass@ip:port`
- SOCKS5: `socks5://user:pass@ip:port`
- Без прокси: оставить пустым после `:`

## How It Works

### Per-Wallet Flow

```
┌─────────────────────────────────────────┐
│           WALLET INITIALIZATION          │
├─────────────────────────────────────────┤
│                                         │
│  1. GET /api/get-burner?wallet=0x...    │
│     ↓                                   │
│  2. Burner exists?                      │
│     ├─ YES → Check tap balance          │
│     └─ NO  → Create new burner          │
│                                         │
│  3. Taps remaining?                     │
│     ├─ YES → Start tapping              │
│     └─ NO  → Deposit $10 first          │
│                                         │
└─────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────┐
│            TAP LOOP (infinite)           │
├─────────────────────────────────────────┤
│                                         │
│  WHILE True:                            │
│    POST /api/tap                        │
│    ├─ Success → Log, wait 1.1s          │
│    ├─ No taps → Deposit $10, continue   │
│    └─ Error   → Handle, retry           │
│                                         │
└─────────────────────────────────────────┘
```

### Burner Creation Flow (if no burner)

```
1. Локально генерируем новый keypair (eth-account)
2. Отправляем registerBurner(burnerAddress) в контракт
3. Отправляем deposit(1, 0x0) с ~0.003 ETH
4. POST /api/register-burner - сохраняем в базе
5. Готово к тапам!
```

## API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/get-burner?wallet=X` | GET | Проверить есть ли burner |
| `/api/user/{address}` | GET | Получить tap balance |
| `/api/tap` | POST | Отправить тап |
| `/api/register-burner` | POST | Зарегистрировать burner |

## Blockchain Transactions (via web3.py)

| Function | When | Value |
|----------|------|-------|
| `registerBurner(address)` | Новый burner | 0 ETH |
| `deposit(1, 0x0)` | Нет тапов | ~0.003 ETH |

## Error Handling

| Error | Action |
|-------|--------|
| No burner | Create + register + deposit |
| No taps | Auto-deposit $10 |
| Rate limit | Wait 60s, retry |
| Insufficient gas | Burner gets 70% of deposit |
| Banned wallet | Skip, log warning |
| Network error | Retry with backoff |

## Constants

```python
# Network
CHAIN_ID = 84532  # Base Sepolia
RPC_URL = "https://sepolia.base.org"
CONTRACT = "0x6bdd40883a4828DfFcE33C3A2222a0eFd31DFe1A"
API_BASE = "https://basion.app"

# Settings
PACKAGE_ID = 1  # $10 = 20000 taps
DEPOSIT_ETH = 0.003  # ~$10
TAP_DELAY = 1.1  # seconds
MAX_WALLETS = 10
```

## Dependencies (requirements.txt)

```
web3>=6.0.0
eth-account>=0.10.0
httpx>=0.25.0
python-dotenv>=1.0.0
aiofiles>=23.0.0
```

## Usage

```bash
# 1. Установить зависимости
pip install -r requirements.txt

# 2. Создать wallets.txt
echo "0xYourPrivateKey:http://proxy:port" > wallets.txt

# 3. Запустить бота
python main.py
```

## Output Example

```
[18:30:00] [INFO] Basion Bot v1.0 starting...
[18:30:00] [INFO] Loaded 3 wallets from wallets.txt
[18:30:00] [0x52a...] Starting worker...
[18:30:00] [0x7cf...] Starting worker...
[18:30:00] [0x1ab...] Starting worker...
[18:30:01] [0x52a...] Burner found: 0xabc...
[18:30:01] [0x52a...] Taps: 15420 | Starting tap loop
[18:30:01] [0x7cf...] No burner! Creating...
[18:30:05] [0x7cf...] Burner created: 0xdef...
[18:30:06] [0x7cf...] Depositing $10...
[18:30:20] [0x7cf...] Deposit confirmed! +20000 taps
[18:30:02] [0x52a...] TAP ok | pts: 4580 | taps: 15419
[18:30:03] [0x52a...] TAP ok | pts: 4581 | taps: 15418
[18:30:21] [0x7cf...] TAP ok | pts: 1 | taps: 19999
...
```

## Important Notes

1. **Приватники** - хранятся ТОЛЬКО в wallets.txt
2. **Burner key** - сервер шифрует и хранит, тебе не нужен
3. **Депозит** - идёт из main wallet напрямую в контракт
4. **Тапы** - идут через API (сервер использует burner)
5. **70% ETH** от депозита идёт на burner для газа
6. **Нет лимитов** - бот будет депозитить пока есть ETH
