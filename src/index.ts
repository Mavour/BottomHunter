import { loadConfig, AppConfig } from './config';
import { validateGmgnConfig } from './adapters/gmgn';
import { Alerter } from './alerter';
import { runScan } from './scanner';

// ─── Banner ─────────────────────────────────────────────────────────────────

function printBanner(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  scanner-dip — GMGN SuperTrend + EMA Alert Bot               ║
║  Solana meme token scanner with SuperTrend OR EMA support    ║
╚══════════════════════════════════════════════════════════════╝
`);
}

// ─── Shutdown ───────────────────────────────────────────────────────────────

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[MAIN] ${signal} received — shutting down...`);
  clearInterval(pollTimer);
  await alerter.stop();
  process.exit(0);
}

let pollTimer: NodeJS.Timeout;

// ─── Startup validation ─────────────────────────────────────────────────────

async function validateStartup(): Promise<boolean> {
  console.log('[MAIN] Validating startup...');

  // Check gmgn-cli
  console.log('[MAIN] Checking gmgn-cli...');
  const gmgnOk = await validateGmgnConfig();
  if (!gmgnOk) {
    console.error('[MAIN] ❌ gmgn-cli not configured. Run: gmgn-cli config --check');
    return false;
  }
  console.log('[MAIN] ✅ gmgn-cli OK');

  // Quick connectivity test
  console.log('[MAIN] Testing GMGN connectivity...');
  try {
    const { getSignalBuys } = await import('./adapters/gmgn');
    const testSignals = await getSignalBuys(1);
    console.log(`[MAIN] ✅ GMGN connectivity OK (${testSignals.length} signals in sample)`);
  } catch (err) {
    console.error('[MAIN] ❌ GMGN connectivity failed:', err);
    return false;
  }

  return true;
}

// ─── Main ───────────────────────────────────────────────────────────────────

let alerter: Alerter;
let config: AppConfig;

async function main(): Promise<void> {
  printBanner();

  // Load config (throws if missing required vars)
  try {
    config = loadConfig();
  } catch (err) {
    console.error('[MAIN] Config error:', err);
    process.exit(1);
  }

  console.log(`[MAIN] Poll interval: ${config.pollIntervalMs / 1000}s`);
  console.log(`[MAIN] Telegram send: ${config.telegramSendEnabled ? 'ENABLED' : 'DRY-RUN'}`);
  console.log(`[MAIN] SuperTrend: period=${config.supertrend.period}, multiplier=${config.supertrend.multiplier}`);
  console.log(`[MAIN] StochRSI: k=${config.stochrsi.kPeriod}, d=${config.stochrsi.dPeriod}, smoothK=${config.stochrsi.smoothK}`);

  // Validate startup
  if (!(await validateStartup())) {
    process.exit(1);
  }

  // Init alerter
  alerter = new Alerter(config.telegramBotToken, config.telegramChatId, config.telegramSendEnabled, config.pollIntervalMs);

  // Start bot to listen for commands
  alerter.onScanRequest(() => runScan(config, alerter));
  await alerter.startBot();

  // Send startup notification
  console.log('[MAIN] Sending startup notification...');
  const startOk = await alerter.sendTestMessage();
  if (!startOk) {
    console.error('[MAIN] ❌ Startup notification failed — check BOT_TOKEN and CHAT_ID');
    process.exit(1);
  }
  console.log('[MAIN] ✅ Startup notification sent');

  // Register shutdown handlers
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Run first scan immediately
  console.log('[MAIN] Running initial scan...');
  try {
    await runScan(config, alerter);
  } catch (err) {
    console.error('[MAIN] Initial scan error:', err);
  }

  // Schedule periodic scans
  pollTimer = setInterval(async () => {
    if (shuttingDown) return;
    try {
      await runScan(config, alerter);
    } catch (err) {
      console.error('[MAIN] Scan error:', err);
    }
  }, config.pollIntervalMs);

  console.log(`[MAIN] Bot running — scanning every ${config.pollIntervalMs / 1000}s`);
}

main().catch((err) => {
  console.error('[MAIN] Fatal error:', err);
  process.exit(1);
});