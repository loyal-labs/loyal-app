import {
  createRequestHandler,
  createTelegramSender,
  loadConfig,
} from "./app.ts";
import { AlertRelay } from "./relay.ts";

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
});

const cleanupTimer = setInterval(() => relay.cleanup(), 60_000);
cleanupTimer.unref();

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

  clearInterval(cleanupTimer);
  console.info(JSON.stringify({ event: "server_stopping", signal }));

  // `false` keeps active connections alive until their handler resolves.
  await server.stop(false);

  console.info(JSON.stringify({ event: "server_stopped", signal }));
  process.exit(0);
}

process.on("SIGTERM", (signal) => void shutdown(signal));
process.on("SIGINT", (signal) => void shutdown(signal));
