# Basion API Bot - Project Manifest

## Overview
Simple Python bot for Basion tap farming using API endpoints only.
No database access, no encryption keys, just API calls.

## Core Features
- Automated tapping via /api/tap
- Auto-deposit when taps run out (NO limits)
- Proxy support
- Single wallet operation
- 1.1 second tap interval

## Tech Stack
- **Language:** Python 3.11+
- **HTTP:** requests
- **Blockchain:** web3.py (for deposit only)
- **Signing:** eth-account

## Project Structure
```
basion-api-bot/
├── .env                    # Private key + proxy
├── requirements.txt        # Dependencies
├── main.py                 # Single file bot
└── logs/                   # Log files (auto-created)
```

## .env Configuration
```env
# REQUIRED: Your main wallet private key
MAIN_PRIVATE_KEY=0x...

# OPTIONAL: Proxy for requests
PROXY=http://user:pass@ip:port

# OPTIONAL: API base URL (default: https://basion.app)
API_BASE=https://basion.app
```

## How It Works

1. **Startup**
   - Load private key from .env
   - Create wallet from private key
   - Call /api/init to check status

2. **Initial Setup** (if tapBalance = 0)
   - Send registerBurnerTx (if burner not registered)
   - Send depositTx (0.003 ETH for 20000 taps)

3. **Tap Loop**
   - POST /api/tap every 1.1 seconds
   - On "No taps remaining" → auto-deposit
   - On "Rate limit" → wait 60s
   - Repeat forever

## Key Differences from Direct Bot

| Feature | Direct Bot | API Bot |
|---------|-----------|---------|
| Supabase access | Required | NOT needed |
| Encryption key | Required | NOT needed |
| Burner key handling | Manual | Automatic |
| Tap execution | Burner signs | Backend signs |
| Complexity | High | Low |

## Constraints
- Tap interval: 1.1 seconds (rate limit protection)
- Package: ID 1 only (0.003 ETH = 20000 taps)
- Balance limits: NONE (always auto-buy)
- **Maintenance mode**: Bot MUST stop when error = "MAINTENANCE"

## Usage
```bash
# Install dependencies
pip install -r requirements.txt

# Set your private key in .env
echo "MAIN_PRIVATE_KEY=0x..." > .env

# Run bot
python main.py
```

## Prompt for Cursor AI

Используй этот промпт чтобы Cursor создал бота:

---

**Промпт:**

```
Создай Python бота для Basion dApp который:

1. Читает MAIN_PRIVATE_KEY и PROXY из .env
2. Подписывает сообщения для API используя eth-account
3. Использует /api/init для инициализации (создаёт burner автоматически)
4. Использует /api/tap для тапов (бекенд сам отправляет транзакции)
5. Когда тапы заканчиваются ("No taps remaining") - автоматически делает deposit:
   - Вызывает /api/init чтобы получить depositTx
   - Отправляет транзакцию напрямую в блокчейн (0.003 ETH)
   - НЕТ ЛИМИТОВ НА БАЛАНС - всегда покупать когда тапов нет
6. Тапает каждые 1.1 секунды
7. Логирует все действия с таймстампами

Технические детали:
- API: https://basion.app
- Network: Base Sepolia (chainId 84532)
- RPC: https://sepolia.base.org
- Package ID: 1 (0.003 ETH = 20000 taps)
- Signature message для init: "Basion init for {wallet} at {timestamp}"
- Signature message для tap: "Basion tap for {wallet} at {timestamp}"
- timestamp = str(int(time.time() * 1000))

Прочитай cursor-context.md и specification.md для полной документации API.
```

---
