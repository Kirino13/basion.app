# Промпт для создания Basion Bot

Скопируй этот промпт и вставь в Cursor AI чтобы создать бота.

---

## Промпт (скопируй всё ниже):

```
Создай Python бота для Basion dApp с поддержкой до 10 кошельков.

## Входные данные

Файл wallets.txt в формате:
PRIVATE_KEY:PROXY

Примеры:
0xABC123...DEF:http://user:pass@ip:port
0x789DEF...ABC:socks5://user:pass@ip:port
0xDEF456...789:

## Логика бота

### Для каждого кошелька (параллельно):

1. ПРОВЕРИТЬ BURNER:
   - GET /api/get-burner?wallet={address}
   - Если {"exists": false} → создать burner (см. ниже)
   - Если {"exists": true} → проверить tap balance

2. ЕСЛИ НЕТ BURNER:
   a. Сгенерировать новый keypair локально (eth_account.Account.create())
   b. Вызвать registerBurner(burnerAddress) в контракте
   c. Вызвать deposit(1, 0x0) с 0.003 ETH
   d. POST /api/register-burner с данными burner

3. ПРОВЕРИТЬ ТАПЫ:
   - GET /api/user/{address}
   - Если tapsRemaining == 0 → deposit $10
   - Если tapsRemaining > 0 → сразу tap loop

4. TAP LOOP (бесконечный):
   - POST /api/tap с signature
   - Если success → log, wait 1.1s
   - Если "No taps remaining" → deposit $10, continue
   - Если "Rate limit" → wait 60s, continue
   - Если "banned" → stop worker

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/get-burner?wallet=X | GET | Проверить burner |
| /api/user/{address} | GET | Получить tapsRemaining |
| /api/register-burner | POST | Сохранить burner в базе |
| /api/tap | POST | Отправить тап |

## Signature Messages

- Для /api/tap: "Basion tap for {wallet} at {timestamp}"
- Для /api/register-burner: "Register burner {burnerWallet} for {mainWallet} at {timestamp}"
- timestamp = str(int(time.time() * 1000))

## POST /api/tap Request

{
  "wallet": "0x...",
  "signature": "0x...",
  "timestamp": "1234567890123",
  "count": 1
}

## POST /api/register-burner Request

{
  "mainWallet": "0x...",
  "burnerWallet": "0x...",
  "privateKey": "0x... (burner private key)",
  "signature": "0x...",
  "timestamp": "1234567890123"
}

## Blockchain Transactions (web3.py)

Contract: 0x21f7944eD2F9ae2d09C9CcF55EDa92D1956d921a
Chain ID: 8453 (Base Mainnet)
RPC: https://mainnet.base.org

Функции контракта:
- registerBurner(address burner) - регистрация burner, value=0
- deposit(uint8 packageId, address referrer) - депозит

Пакеты:
- packageId = 0: $3 = 2000 taps, value = 0.001 ETH
- packageId = 1: $10 = 7000 taps, value = 0.003 ETH

Параметры для deposit:
- packageId = 1 (7000 taps за $10)
- referrer = 0x0000000000000000000000000000000000000000
- value = 0.003 ETH

## Константы

API_BASE = "https://basion.app"
RPC_URL = "https://mainnet.base.org"
CONTRACT = "0x21f7944eD2F9ae2d09C9CcF55EDa92D1956d921a"
CHAIN_ID = 8453
TAP_DELAY = 1.1  # seconds
DEPOSIT_ETH = 0.003
PACKAGE_ID = 1

## Структура проекта

basion-bot/
├── wallets.txt
├── main.py
└── requirements.txt

## requirements.txt

web3>=6.0.0
eth-account>=0.10.0
httpx[socks]>=0.25.0

## Формат логов

[HH:MM:SS] [0x52a...] TAP ok | pts: 4580 | taps: 15419
[HH:MM:SS] [0x52a...] Out of taps! Depositing $10...
[HH:MM:SS] [0x52a...] Deposited! +7000 taps

## Важно

1. До 10 кошельков параллельно (asyncio)
2. Каждый кошелёк со своим прокси
3. Нет лимитов на депозит - всегда докупать когда тапы = 0
4. 1.1 секунды между тапами
5. Burner создаётся ЛОКАЛЬНО и регистрируется в контракте
6. Для подписи используем eth_account.Account.sign_message

Прочитай specification.md, manifest.md и cursor-context.md в текущей папке для полной документации.
```

---

## Как использовать:

1. Открой Cursor в папке где хочешь создать бота
2. Скопируй весь промпт выше (от "Создай Python бота..." до конца)
3. Вставь в Cursor Chat
4. Дополнительно можно добавить файлы specification.md, manifest.md, cursor-context.md в контекст (@ files)
5. Cursor создаст main.py и requirements.txt
6. Создай wallets.txt со своими приватниками
7. Запусти `python main.py`

---

## Пример wallets.txt:

```
# Приватник:Прокси (прокси опционален)
0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890:http://user:pass@123.45.67.89:8080
0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef:socks5://user:pass@98.76.54.32:1080
0x7890abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456:
```
