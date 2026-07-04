import { Telegraf } from 'telegraf';
import { AlertSignal, SignalSource } from './types';

// ─── Formatters ─────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
}

function fmtPct(pct: number): string {
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
}

function fmtBool(v: boolean): string {
  return v ? 'yes' : 'no';
}

// ─── Message builder ────────────────────────────────────────────────────────

export function buildAlertMessage(signal: AlertSignal, source: SignalSource): string {
  // Determine which indicator triggered
  const triggeredBy = signal.ema.triggered ? 'EMA' : 'SuperTrend';

  // Build the alert title based on trigger
  let title = `🟢 *SUPPORT AREA* — *$${signal.symbol}*`;

  // Build indicator status line
  let indicatorLine = '';
  if (signal.ema.triggered && signal.ema.nearEmaLevel) {
    indicatorLine = `📍 EMA ${signal.ema.nearEmaLevel.period} Support — *$${signal.ema.nearEmaLevel.value.toFixed(6)}*`;
  } else {
    indicatorLine = `📍 SuperTrend BULLISH — Price reclaimed ST line`;
  }

  const stochStatus = signal.stochrsi.crossedAbove ? '✅ Cross' : '⏳ Pending';

  const lines = [
    title,
    ``,
    indicatorLine,
    `📊 StochRSI ${stochStatus} — %K *${signal.stochrsi.k.toFixed(1)}* > %D ${signal.stochrsi.d.toFixed(1)}`,
    ``,
    `╭────────── 📋 *TOKEN INFO* ──────────╮`,
    `│ CA: \`${signal.mint}\``,
    `│ 💰 MCap: *$${fmtNum(signal.marketCap)}*`,
    `│ 📈 Vol 24h: *$${fmtNum(signal.volume24h)}*`,
    `│ 💧 Liquidity: *$${fmtNum(signal.liquidity)}*`,
    `│ 👥 Holders: *${signal.holders.toLocaleString()}*`,
    `│ ⛽ Fee: *${signal.feeSol.toFixed(2)} SOL*`,
    `╰──────────────────────────────────────╯`,
    ``,
    `🔗 *Links:*`,
    `   → [DexScreener](${signal.dexScreenerUrl})`,
    `   → [GMGN](${signal.chartUrl})`,
  ];

  return lines.join('\n');
}

// ─── Alerter ────────────────────────────────────────────────────────────────

export class Alerter {
  private bot: Telegraf | null = null;
  private chatId: string;
  private sendEnabled: boolean;

  constructor(botToken: string, chatId: string, sendEnabled: boolean) {
    this.chatId = chatId;
    this.sendEnabled = sendEnabled;
    if (sendEnabled && botToken) {
      this.bot = new Telegraf(botToken);
    }
  }

  async sendAlert(signal: AlertSignal, source: SignalSource): Promise<boolean> {
    const msg = buildAlertMessage(signal, source);

    console.log(`[ALERT] ${source.toUpperCase()} alert for $${signal.symbol} (${signal.mint.slice(0, 8)})`);
    console.log(msg);
    console.log('─'.repeat(60));

    if (!this.sendEnabled) {
      console.log('[ALERT] Dry-run mode — message NOT sent');
      return true;
    }

    if (!this.bot) {
      console.error('[ALERT] Telegram bot not initialized — check TELEGRAM_BOT_TOKEN');
      return false;
    }

    try {
      await this.bot.telegram.sendMessage(this.chatId, msg, { parse_mode: 'Markdown' });
      console.log(`[ALERT] ✅ Sent: $${signal.symbol}`);
      return true;
    } catch (err) {
      console.error(`[ALERT] ❌ Failed to send: ${err}`);
      return false;
    }
  }

  async sendTestMessage(): Promise<boolean> {
    const msg = '🧪 *Test Message*\\n\\nBot is running correctly!';

    if (!this.sendEnabled) {
      console.log('[ALERT] Dry-run — test message NOT sent');
      return true;
    }

    if (!this.bot) {
      console.error('[ALERT] Bot not initialized');
      return false;
    }

    try {
      await this.bot.telegram.sendMessage(this.chatId, msg, { parse_mode: 'Markdown' });
      return true;
    } catch (err) {
      console.error('[ALERT] Test message failed:', err);
      return false;
    }
  }

  async stop(): Promise<void> {
    if (this.bot) await this.bot.stop();
  }
}

export default Alerter;