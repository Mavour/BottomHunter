# scanner-dip

GMGN-only Solana SuperTrend alert bot. Scans smart money signals and trending tokens, calculates 5m SuperTrend + StochRSI, sends Telegram alerts when technical conditions confirm a bullish bounce.

**Alert-only — no auto-buy.** All data from GMGN CLI. No Helius, no Birdeye, no DexScreener.

---

## How it works

```
Every 60s:
  1. Fetch smart money buy signals (gmgn-cli market signal --signal-type 12)
     → fast path: if SuperTrend green + StochRSI cross → alert immediately

  2. Fetch trending tokens (gmgn-cli market trending --interval 24h)
     → slow path: apply filters → check indicators → alert if valid
```

**Signal trigger (both paths):**
- SuperTrend (10, 3) direction = bullish AND close > ST line (reclaimed)
- StochRSI (14, 14, 3, 3): %K crosses above %D on last candle, %K < 80 (not overbought)
- All configured filter thresholds pass

---

## Setup

```bash
# 1. Clone / navigate to project
cd scanner-dip

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
TELEGRAM_SEND_ENABLED=false npm run dev

# 8. Start for real
TELEGRAM_SEND_ENABLED=true npm run dev
```

---

## Configuration

### filters.config.json

All thresholds are **configurable**. Token passes only when ALL configured thresholds pass.

| Key | Type | Description |
|-----|------|-------------|
| `rug_check.renounced_mint` | bool | Require mint authority renounced |
| `rug_check.renounced_freeze_account` | bool | Require freeze authority renounced |
| `top_10_holder_rate_max` | % | Max concentration in top 10 holders |
| `dev_team_hold_rate_max` | % | Max dev team hold |
| `suspected_insider_hold_rate_max` | % | Max suspected insider hold |
| `rat_trader_amount_rate_max` | % | Max entrapment rate |
| `bundler_trader_amount_rate_max` | % | Max bundler rate |
| `smart_degen_count_min` | count | Min smart degen wallets |
| `bot_degen_count_max` | count | Max bot/degen wallets |
| `sniper_count_max` | count | Max sniper wallets |
| `vol24h_min` | USD | Min 24h volume |
| `mcap_min` / `mcap_max` | USD | Market cap range |
| `vs_ath_pct_max` | % | Max distance from ATH |
| `require_not_wash_trading` | bool | Reject wash-traded tokens |
| `require_has_social` | bool | Require at least one social link |

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
├── adapters/gmgn.ts       # gmgn-cli wrapper (all API calls)
├── indicators/
│   ├── supertrend.ts      # SuperTrend (10,3) — meridian reference impl
│   └── stochrsi.ts        # StochRSI (14,14,3,3) — proper %K/%D
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
🔔 SIGNAL — $MOODENG
CA: 7nCq...L4Sd

mcap $2.34M · vol24h $892.12K · liq $187.45K · holders 4821
Δ5m +3.21% · Δ1h +8.45% · vsATH -12.34%

Safety:
rug yes · top10 42% · dev 3% · insider 8% · bundler 12% · entramp 5%
sniper 89 · bot-degen 12 · smart-degen 4 · renowned 2
renounced mint/freeze: yes/yes · wash: no · social: yes

5m SuperTrend: 🟢 BULLISH
Price: $0.001234 above ST line $0.001198
StochRSI: %K 52.34 crossed above %D 48.12 (not overbought)

Chart: https://gmgn.ai/sol/token/7nCq...L4Sd
```

---

## License

MIT