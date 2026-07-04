# scanner-dip

GMGN Solana SuperTrend + EMA alert bot. Scans smart money signals and trending tokens, calculates SuperTrend or EMA support zone + StochRSI, sends Telegram alerts when technical conditions confirm a bullish bounce.

**Alert-only — no auto-buy.** Data from GMGN API.

---

## How it works

```
Every 60s:
  1. Fetch smart money buy signals
     → fast path: if (SuperTrend green OR EMA support) + StochRSI cross → alert immediately

  2. Fetch trending tokens
     → slow path: apply filters → check indicators → alert if valid
```

**Signal trigger (both paths) — OR logic:**
- **Path A — SuperTrend:** SuperTrend (10, 3) direction = bullish AND close > ST line (reclaimed)
- **Path B — EMA Support:** Price near/below EMA 25/50/100/200 (support zone)
- **StochRSI (14, 14, 3, 3):** %K crosses above %D on last candle, %K < 80 (not overbought)
- All configured filter thresholds pass

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

# 7. Dry-run test (no Telegram messages sent)
npm run dev:dry

# 8. Start for real
npm run dev
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
| `vol24h_min` | USD | `500000` | Min 24h volume |
| `mcap_min` | USD | `350000` | Min market cap |
| `mcap_max` | USD | `0` | Max market cap (0 = no limit) |
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
