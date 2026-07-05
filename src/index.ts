import { loadConfig, AppConfig } from './config';
import { validateGmgnConfig } from './adapters/gmgn';
import { Alerter } from './alerter';
import { runScan } from './scanner';
import { ScanStats } from './types';

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
let isScanInProgress = false;
let consecutiveScanFailures = 0;
let scannerDownAlerted = false;

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
let lastScanTimestamp = Date.now();

async function executeScan(): Promise<void> {
  if (shuttingDown) return;

  // Overlap guard — skip jika scan sebelumnya belum selesai
  if (isScanInProgress) {
    console.log('[MAIN] Scan sebelumnya belum selesai — skip tick ini');
    return;
  }

  isScanInProgress = true;
  try {
    const stats = await runScan(config, alerter);
    lastScanTimestamp = Date.now();
    alerter.updateScanStats(stats.cycle);
    // Reset escalation alert on success
    consecutiveScanFailures = 0;
    scannerDownAlerted = false;
    alerter.setConsecutiveScanFailures(0);

    if (stats.cycle % config.heartbeatEveryNCycles === 0) {
      await alerter.sendHeartbeat(stats);
    }
  } catch (err) {
    lastScanTimestamp = Date.now();
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[MAIN] Scan error:', errMsg);

    consecutiveScanFailures++;
    alerter.setConsecutiveScanFailures(consecutiveScanFailures);

    // Escalation alert — 3 consecutive failures
    if (consecutiveScanFailures >= 3 && !scannerDownAlerted) {
      scannerDownAlerted = true;
      await alerter.sendMessage('⚠️ *Scanner Down*\n\nBot gagal scan 3x berturut. Cek log VPS.\n_Coba /screening manual untuk test._').catch(() => {});
    }

    const cycle = alerter.getScanCycleCount() + 1;
    alerter.updateScanStats(cycle);
    if (cycle % config.heartbeatEveryNCycles === 0) {
      await alerter.sendHeartbeat({
        cycle,
        signalsChecked: 0,
        poolsChecked: 0,
        alertsSent: 0,
        durationMs: 0,
        error: errMsg,
      });
    }
  } finally {
    isScanInProgress = false;
    if (!shuttingDown) {
      const nextTime = new Date(Date.now() + config.pollIntervalMs).toLocaleTimeString();
      console.log(`[MAIN] Next scan scheduled at ${nextTime}`);
    }
  }
}

async function main(): Promise<void> {
  printBanner();

  // Load config (throws if missing required vars)
  try {
    config = loadConfig();
  } catch (err) {
    console.error('[MAIN] Config error:', err);
    process.exit(1);
  }

  console.log(`[MAIN] Poll interval confirmed: ${config.pollIntervalMs}ms (${config.pollIntervalMs / 60000} minutes)`);
  console.log(`[MAIN] Heartbeat every: ${config.heartbeatEveryNCycles} cycle(s)`);
  console.log(`[MAIN] Mcap range: $${config.filters.mcap_min.toLocaleString()} — $${config.filters.mcap_max.toLocaleString()}`);
  console.log(`[MAIN] Telegram send: ${config.telegramSendEnabled ? 'ENABLED' : 'DRY-RUN'}`);
  console.log(`[MAIN] SuperTrend: period=${config.supertrend.period}, multiplier=${config.supertrend.multiplier}`);
  console.log(`[MAIN] StochRSI: k=${config.stochrsi.kPeriod}, d=${config.stochrsi.dPeriod}, smoothK=${config.stochrsi.smoothK}`);
  console.log(`[MAIN] Initial scan runs immediately on startup, subsequent scans are scheduled every ${config.pollIntervalMs / 60000} minutes AFTER previous scan completes (not wall-clock aligned).`);

  // Validate startup
  if (!(await validateStartup())) {
    process.exit(1);
  }

  // Init alerter
  alerter = new Alerter(config.telegramBotToken, config.telegramChatId, config.telegramSendEnabled, config.pollIntervalMs);

  // Start bot to listen for commands
  alerter.onScanRequest(() => executeScan());
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
  await executeScan();

  // Schedule periodic scans
  pollTimer = setInterval(executeScan, config.pollIntervalMs);

  console.log(`[MAIN] Bot running — scanning every ${config.pollIntervalMs / 1000}s`);
}

main().catch((err) => {
  console.error('[MAIN] Fatal error:', err);
  process.exit(1);
});