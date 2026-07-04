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
    indicatorLine = `📍 SuperTrend BULLISH — Price near ST line`;
  }

  const stochStatus = signal.stochrsi.crossedAbove ? '✅ Cross' : '⏳ Pending';
  const tfLabel = signal.timeframe || '5m';

  const lines = [
    title,
    ``,
    indicatorLine,
    `📊 Timeframe: *${tfLabel}*`,
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
      this.setupCommands();
    }
  }

  private setupCommands(): void {
    if (!this.bot) return;

    // /start command
    this.bot.command('start', (ctx) => {
      const msg = [
        `🟢 *Scanner Dip Bot*`,
        ``,
        `Bot ini akan mengirim alert ketika token Solana memenuhi kondisi:`,
        `• SuperTrend BULLISH (near bottom)`,
        `• ATAU EMA Support Zone (25/50/100/200)`,
        `• + StochRSI Cross Up`,
        ``,
        `📊 *Timeframe:* 5m / 15m / 1h / 4h`,
        `⛽ *Min Fee:* 30 SOL`,
        `💰 *Min MCap:* $350,000`,
        ``,
        `*Commands:*`,
        `/start — Tampilkan pesan ini`,
        `/status — Cek status bot`,
        `/help — Bantuan`,
      ].join('\n');

      ctx.reply(msg, { parse_mode: 'Markdown' });
    });

    // /status command
    this.bot.command('status', (ctx) => {
      const msg = [
        `✅ *Bot Status: Running*`,
        ``,
        `⏱ Scan interval: 60 detik`,
        `📊 Timeframes: 5m, 15m, 1h, 4h`,
        `🔄 Mode: Alert-only (no auto-buy)`,
      ].join('\n');

      ctx.reply(msg, { parse_mode: 'Markdown' });
    });

    // /help command
    this.bot.command('help', (ctx) => {
      const msg = [
        `📖 *Bantuan*`,
        ``,
        `Bot ini scan token Solana setiap 60 detik.`,
        `Ketika ada token yang memenuhi kondisi indikator,`,
        `bot akan mengirim alert ke chat ini.`,
        ``,
        `*Yang di-check:`,
        `• SuperTrend (10,3) — near bottom`,
        `• EMA 25/50/100/200 — support zone`,
        `• StochRSI (14,14,3,3) — cross up`,
        ``,
        `*Filter:`,
        `• Min Fee: 30 SOL`,
        `• Min MCap: $350K`,
        `• Min Vol: $500K`,
        `• Min Liq: $5K`,
        `• Min Age: 6 jam`,
      ].join('\n');

      ctx.reply(msg, { parse_mode: 'Markdown' });
    });

    // Handle all other messages
    this.bot.on('message', (ctx) => {
      ctx.reply('Ketik /start untuk memulai atau /help untuk bantuan.');
    });
  }

  async startBot(): Promise<void> {
    if (!this.bot) {
      console.error('[ALERT] Bot not initialized');
      return;
    }

    try {
      await this.bot.launch();
      console.log('[ALERT] ✅ Bot started and listening for commands');
    } catch (err) {
      console.error('[ALERT] ❌ Failed to start bot:', err);
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
    const msg = '🧪 *Test Message*\n\nBot is running correctly!';

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
    if (this.bot) {
      this.bot.stop('SIGTERM');
    }
  }
}

export default Alerter;