import {
  createAlertAnalyzer,
  createRequestHandler,
  createTelegramSender,
  loadConfig,
  type ServerConfig,
} from "./app.ts";
import { redactSecrets } from "./redact.ts";
import { AlertRelay } from "./relay.ts";
import {
  createDatabaseStateStore,
  createFileStateStore,
  createNullStateStore,
  type StateStore,
} from "./state-store.ts";

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

const stateStore = createStateStore(config);
const restored = await restoreState();

/**
 * Belt and braces around the boot restore. `importState` already skips the
 * pieces of a snapshot it cannot read, but this is top-level module scope: an
 * escape here kills the process before it binds a port, and Render would
 * restart it into the same bad row indefinitely. Starting with empty state
 * costs duplicate messages once.
 */
async function restoreState(): Promise<number> {
  try {
    const savedState = await stateStore.load();
    return savedState ? relay.importState(savedState) : 0;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "state_restore_failed",
        errorMessage: redactSecrets(
          error instanceof Error ? error.message : String(error)
        ).slice(0, 300),
      })
    );
    return 0;
  }
}

// Sweeping posts the restart and daily recaps when they come due, so it is not
// optional bookkeeping the way the old cache eviction was.
const sweepTimer = setInterval(() => {
  void sweep();
}, config.sweepIntervalMs);
sweepTimer.unref();

async function sweep(): Promise<void> {
  await relay.sweep();
  await stateStore.save(relay.exportState());
}

/**
 * Window state is in-process, so a deploy would otherwise re-alert everything
 * that is still firing and reset the daily tally. A shared table survives that
 * without pinning the service to a disk; a file works but makes Render stop the
 * old instance before starting the new one. With neither, the relay falls back
 * to the restart grace period, which at least folds the burst into one message.
 */
function createStateStore(serverConfig: ServerConfig): StateStore {
  if (serverConfig.stateDatabaseUrl) {
    try {
      return databaseStateStore(serverConfig);
    } catch (error) {
      // The driver validates the connection string when it is constructed, and
      // a malformed one would otherwise take the process down at boot. A relay
      // that will not start posts nothing at all, which is far worse than one
      // running without a snapshot — so this fails open like every other store
      // operation, loudly enough to be found in the deploy logs.
      console.error(
        JSON.stringify({
          event: "state_store_unavailable",
          errorMessage: redactSecrets(
            error instanceof Error ? error.message : String(error)
          ).slice(0, 300),
        })
      );
      return createNullStateStore();
    }
  }

  if (serverConfig.stateFile) {
    return createFileStateStore(serverConfig.stateFile);
  }

  return createNullStateStore();
}

function databaseStateStore(serverConfig: ServerConfig): StateStore {
  return createDatabaseStateStore({
    databaseUrl: serverConfig.stateDatabaseUrl,
    stateKey: serverConfig.stateKey,
    leaseSeconds: serverConfig.stateLeaseSeconds,
  });
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
    stateStore: stateStore.kind,
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
  // requests accumulated, and the lease is dropped straight afterwards so the
  // replacement instance can start writing without waiting it out.
  await stateStore.save(relay.exportState());
  await stateStore.release();

  console.info(JSON.stringify({ event: "server_stopped", signal }));
  process.exit(0);
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
