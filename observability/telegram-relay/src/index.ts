import {
  createAlertAnalyzer,
  createRequestHandler,
  createTelegramSender,
  loadConfig,
  type ServerConfig,
} from "./app.ts";
import { redactBotToken } from "./redact.ts";
import { AlertRelay, type PersistedState } from "./relay.ts";

function readConfig() {
  try {
    return loadConfig(process.env);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "server_start_failed",
        error: error instanceof Error ? error.message : "unknown config error",
      })
    );
    process.exit(1);
  }
}

const config = readConfig();
const relay = new AlertRelay(createTelegramSender(config), {
  cooldownMs: config.cooldownMs,
  idempotencyTtlMs: config.idempotencyTtlMs,
  maxCacheEntries: config.maxCacheEntries,
  analyze: createAlertAnalyzer(config),
  dailyRecapEnabled: config.dailyRecapEnabled,
  dailyRecapAtMinutes: config.dailyRecapAtMinutes,
  escalationMultiplier: config.escalationMultiplier,
  restartGraceMs: config.restartGraceMs,
});

const restored = await restoreState(config, relay);

// Sweeping posts the restart and daily recaps when they come due, so it is not
// optional bookkeeping the way the old cache eviction was.
const sweepTimer = setInterval(() => {
  void sweep();
}, config.sweepIntervalMs);
sweepTimer.unref();

async function sweep(): Promise<void> {
  await relay.sweep();
  await persistState(config, relay);
}

/**
 * Window state is in-process, so a deploy would otherwise re-alert everything
 * that is still firing. With no `STATE_FILE` the relay falls back to the
 * restart grace period, which folds that burst into a single message.
 */
async function restoreState(
  serverConfig: ServerConfig,
  target: AlertRelay
): Promise<number> {
  if (!serverConfig.stateFile) {
    return 0;
  }

  try {
    const file = Bun.file(serverConfig.stateFile);
    if (!(await file.exists())) {
      return 0;
    }
    const state = (await file.json()) as PersistedState;
    return target.importState(state);
  } catch (error) {
    // A corrupt or unreadable snapshot must never stop the relay from
    // accepting alerts; it only costs the duplicate messages it would have
    // prevented.
    console.error(
      JSON.stringify({
        event: "state_restore_failed",
        errorMessage: errorText(error),
      })
    );
    return 0;
  }
}

async function persistState(
  serverConfig: ServerConfig,
  source: AlertRelay
): Promise<void> {
  if (!serverConfig.stateFile) {
    return;
  }

  try {
    await Bun.write(
      serverConfig.stateFile,
      JSON.stringify(source.exportState())
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "state_persist_failed",
        errorMessage: errorText(error),
      })
    );
  }
}

function errorText(error: unknown): string {
  return redactBotToken(
    error instanceof Error ? error.message : String(error)
  ).slice(0, 300);
}

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  maxRequestBodySize: config.maxBodyBytes,
  fetch: createRequestHandler(relay, config),
});

console.info(
  JSON.stringify({
    event: "server_started",
    url: server.url.toString(),
    webhookPath: "/webhooks/clickstack",
    cooldownSeconds: config.cooldownMs / 1000,
    restartGraceSeconds: config.restartGraceMs / 1000,
    restoredWindows: restored,
  })
);

// Render sends SIGTERM on every deploy and restart. Without this, an in-flight
// webhook is cut mid-delivery: ClickStack sees a connection reset rather than a
// status code, and that alert is lost unless it happens to re-fire. Draining
// lets the request finish and return 200, or 502 so ClickStack retries.
let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  clearInterval(sweepTimer);
  console.info(JSON.stringify({ event: "server_stopping", signal }));

  // `false` keeps active connections alive until their handler resolves.
  await server.stop(false);

  // Written after the drain so the snapshot includes whatever those last
  // requests accumulated.
  await persistState(config, relay);

  console.info(JSON.stringify({ event: "server_stopped", signal }));
  process.exit(0);
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
