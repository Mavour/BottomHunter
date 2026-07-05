# scanner-dip

GMGN Solana SuperTrend + EMA alert bot. Scans smart money signals and trending tokens, calculates SuperTrend or EMA support zone + StochRSI, sends Telegram alerts when technical conditions confirm a bullish bounce.

**Alert-only — no auto-buy.** Data from GMGN API.

---

## How it works

```
Every 60s:
  1. Fetch smart money buy signals
     → filterTrending() (vol24h, liq, holders, rug, social, honeypot)
     → if passed: fee check → enrich → indicators → alert

  2. Fetch Meteora DLMM pools (server-side mcap filter, 24h volume window)
     → age check → filterTrending() (same filter as signals)
     → if passed: fee check → enrich → indicators → alert
```

**Signal trigger (both paths) — OR logic:**
- **Path A — SuperTrend:** SuperTrend (10, 3) direction = bullish AND close > ST line (reclaimed)
- **Path B — EMA Support:** Price near/below EMA 25/50/100/200 (support zone)
- **StochRSI (14, 14, 3, 3):** %K crosses above %D on last candle, %K < 80 (not overbought)
- **All configured filter thresholds pass — same `filterTrending()` applied to BOTH paths**

---

## Setup

```bash
# 1. Clone
git clone https://github.com/Mavour/BottomHunter.git
cd BottomHunter

# 2. Install dependencies
npm install

# 3. Install gmgn-cli globally
npm install -g gmgn-cli

# 4. Configure GMGN API key
gmgn-cli config --apply <YOUR_GMGN_API_KEY>

# 5. Copy and edit env
cp .env.example .env
# Set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

# 6. Edit filter thresholds
# Edit filters.config.json — all values are configurable

# 7. Build TypeScript
npm run build

# 8. Dry-run test (no Telegram messages sent)
npm run dev:dry

# 9. Start for real
npm run dev
```

---

## VPS Deployment (PM2)

### Install PM2 globally
```bash
npm install -g pm2
```

### Build & Start
```bash
# Build TypeScript
npm run build

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 process list (auto-start on reboot)
pm2 save

# Generate startup script
pm2 startup
```

### PM2 Commands
```bash
# Check status
pm2 status

# View logs
pm2 logs scanner-dip

# Monitor resources
pm2 monit

# Restart
pm2 restart scanner-dip

# Stop
pm2 stop scanner-dip

# Delete
pm2 delete scanner-dip
```

### Auto-restart on VPS reboot
```bash
pm2 startup
# Follow the command it shows you, then:
pm2 save
```

### View logs in real-time
```bash
pm2 logs scanner-dip --lines 100
```

---

## Configuration

### filters.config.json

All thresholds are **configurable**. Token passes only when ALL configured thresholds pass.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `rug_check.renounced_mint` | bool | `true` | Require mint authority renounced |
| `rug_check.renounced_freeze_account` | bool | `true` | Require freeze authority renounced |
| `top_10_holder_rate_max` | % | `60` | Max concentration in top 10 holders |
| `vol24h_min` | USD | `500000` | Min 24h volume (Meteora pool uses 24h API window) |
| `mcap_min` | USD | `350000` | Min market cap |
| `mcap_max` | USD | `30000000` | Max market cap (30M; 0 = no limit) |
| `min_liquidity_usd` | USD | `5000` | Min liquidity |
| `min_holders` | count | `0` | Min holder count |
| `min_fee_sol` | SOL | `30` | Min fee in SOL |
| `vs_ath_pct_max` | % | `95` | Max distance from ATH |
| `min_token_age_hours` | hours | `6` | Min token age |
| `require_not_wash_trading` | bool | `false` | Reject wash-traded tokens |
| `require_has_social` | bool | `false` | Require at least one social link |
| `require_not_honeypot` | bool | `false` | Reject honeypot tokens |

### Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GMGN_API_KEY` | Yes | — | GMGN API key |
| `TELEGRAM_BOT_TOKEN` | Yes | — | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Yes | — | Telegram chat ID |
| `TELEGRAM_SEND_ENABLED` | No | `false` | Set `true` to actually send |
| `POLL_INTERVAL_MS` | No | `60000` | Scan interval in ms |
| `FILTERS_CONFIG_PATH` | No | `./filters.config.json` | Path to filters config |
| `HEARTBEAT_EVERY_N_CYCLES` | No | auto | Heartbeat every N cycles (1 if ≥5min interval, else 5) |

---

## Indicator Reference

### SuperTrend (10, 3)

```
hl2 = (high + low) / 2
ATR = Wilder's RMA(true_range, 10)
lower = hl2 - 3 × ATR
upper = hl2 + 3 × ATR
prevLower = prev_hl2 - 3 × ATR

direction = close > prevLower ? bullish : bearish
value = direction === bullish ? lower : upper
```

**Bullish signal:** `direction === bullish` AND `close > value` (price reclaims ST line)

### EMA Support Zone (25, 50, 100, 200)

```
EMA = Previous EMA + (Close - Previous EMA) × Multiplier
Multiplier = 2 / (Period + 1)
```

**Bullish signal:** Price within 2% of any EMA level (25, 50, 100, 200) or below it

### Stochastic RSI (14, 14, 3, 3)

```
RSI = Wilder's RSI(close, 14)
StochRSI_K = (RSI - min_RSI) / (max_RSI - min_RSI) × 100
%K = SMA(StochRSI_K, 3)   ← TradingView convention
%D = SMA(%K, 14)

Bullish cross: prev %K ≤ prev %D AND cur %K > cur %D
Overbought gate: %K < 80
```

---

## Architecture

```
src/
├── adapters/gmgn.ts       # GMGN API wrapper
├── indicators/
│   ├── supertrend.ts      # SuperTrend (10,3)
│   ├── ema.ts             # EMA 25/50/100/200 support zone
│   └── stochrsi.ts        # StochRSI (14,14,3,3)
├── filters.ts             # Filter engine + alert builder
├── scanner.ts             # Scan loop: signal fast path → trending slow path
├── alerter.ts             # Telegram formatter + sender
├── config.ts              # Env + filters.config.json loader
├── types.ts               # TypeScript interfaces
└── index.ts               # Entry point, startup validation
```

---

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Show bot info and available commands |
| `/status` | Check bot status (interval, timeframes, mode) |
| `/health` | Last scan time, cycle count, poll interval |
| `/screening` | Trigger an immediate manual scan |
| `/help` | Show bot help and current filter thresholds |

## Heartbeat

Bot sends a Telegram heartbeat message every N cycles (configurable via `HEARTBEAT_EVERY_N_CYCLES`).
The default is every 1 cycle if `POLL_INTERVAL_MS ≥ 300000` (5 min), otherwise every 5 cycles.

Normal heartbeat:
```
🔄 Cycle #12 selesai
⏱ 8.4s | 🔍 3 signal, 6 pool dicek | 🔔 0 alert
```

Error heartbeat (sent when a scan cycle crashes):
```
❌ Cycle #12 error
⚠️ <error message>
```

---

## Telegram Alert Format

```
SUPPORT AREA - $MOODENG
SuperTrend BULLISH - Price reclaimed ST line
StochRSI: %K 52.34 crossed above %D 48.12

CA: 7nCq...L4Sd

mcap $2.34M · vol24h $892.12K · liq $187.45K · holders 4821
Δ5m +3.21% · Δ1h +8.45% · vsATH -12.34%

Fee: 35.00 SOL / $350K mcap

link: https://dexscreener.com/solana/7nCq...L4Sd
GMGN: https://gmgn.ai/sol/token/7nCq...L4Sd
```

---

## License

MIT
