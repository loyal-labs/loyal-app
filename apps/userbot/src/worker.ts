import { stat } from "node:fs/promises";

import { createUserbotClient, type UserbotClientBundle } from "./lib/client";
import { loadUserbotConfig, type UserbotConfig } from "./lib/env";
import {
  buildReauthGuidance,
  createNonInteractiveStartParams,
} from "./lib/non-interactive-auth";
import { resolveSessionSqlitePath } from "./lib/storage";

type EnvRecord = Record<string, string | undefined>;
type SignalName = "SIGINT" | "SIGTERM";

type Logger = Pick<Console, "error" | "info" | "warn">;

type ProcessSignalLike = {
  once(event: SignalName, listener: () => void): unknown;
};

type WorkerDeps = {
  createClient: (config: UserbotConfig) => Promise<UserbotClientBundle>;
  env: EnvRecord;
  hasFile: (path: string) => Promise<boolean>;
  loadConfig: (env: EnvRecord) => UserbotConfig;
  logger: Logger;
};

function isDirectExecution(scriptName: string): boolean {
  const entrypoint = process.argv[1];
  return typeof entrypoint === "string" && entrypoint.endsWith(scriptName);
}

async function hasFile(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function resolveWorkerDeps(overrides: Partial<WorkerDeps>): WorkerDeps {
  return {
    createClient: overrides.createClient ?? createUserbotClient,
    env: overrides.env ?? process.env,
    hasFile: overrides.hasFile ?? hasFile,
    loadConfig: overrides.loadConfig ?? loadUserbotConfig,
    logger: overrides.logger ?? console,
  };
}

function getIdentityLabel(user: unknown): string {
  if (!user || typeof user !== "object") {
    return "unknown";
  }

  const candidate = user as {
    id?: unknown;
    username?: unknown;
  };

  const id =
    typeof candidate.id === "string"
      ? candidate.id
      : typeof candidate.id === "number"
      ? String(candidate.id)
      : typeof candidate.id === "bigint"
      ? candidate.id.toString()
      : undefined;

  const username =
    typeof candidate.username === "string" &&
    candidate.username.trim().length > 0
      ? candidate.username.trim()
      : undefined;

  if (id && username) {
    return `${id} (@${username})`;
  }

  if (id) {
    return id;
  }

  if (username) {
    return `@${username}`;
  }

  return "unknown";
}

export function createUserbotWorker(overrides: Partial<WorkerDeps> = {}) {
  const deps = resolveWorkerDeps(overrides);

  let activeBundle: UserbotClientBundle | null = null;
  let startupBundle: UserbotClientBundle | null = null;
  let startPromise: Promise<void> | null = null;
  let shutdownPromise: Promise<void> | null = null;

  async function destroyBundle(
    bundle: UserbotClientBundle,
    context: string
  ): Promise<void> {
    try {
      await bundle.client.destroy();
    } catch (error) {
      deps.logger.error(
        `[userbot] Failed to destroy client (${context})`,
        error
      );
    }
  }

  async function start(): Promise<void> {
    if (startPromise) {
      return startPromise;
    }

    startPromise = (async () => {
      const config = deps.loadConfig(deps.env);
      const sessionPath = resolveSessionSqlitePath(
        config.accountKey,
        config.storageDir
      );

      const sessionExists = await deps.hasFile(sessionPath);
      if (!sessionExists && config.authMode === "user") {
        throw new Error(
          `[userbot] Missing session file for '${config.accountKey}'. Run auth:bootstrap first. Expected: ${sessionPath}`
        );
      }
      if (!sessionExists && config.authMode === "bot") {
        deps.logger.info(
          `[userbot] No session found for '${config.accountKey}' in bot mode; proceeding with token-based startup.`
        );
      }

      const bundle = await deps.createClient(config);
      startupBundle = bundle;

      try {
        const user = await bundle.client.start(
          createNonInteractiveStartParams(config)
        );

        bundle.client.onRawUpdate.add(() => {
          // Intentionally noop in foundation PR.
        });

        activeBundle = bundle;
        deps.logger.info(
          `[userbot] Worker started for '${config.accountKey}' (authMode=${config.authMode}).`
        );
        deps.logger.info(`[userbot] Session path: ${bundle.sessionPath}`);
        deps.logger.info(`[userbot] Account: ${getIdentityLabel(user)}`);
      } catch (error) {
        await destroyBundle(bundle, "startup_error");
        throw error;
      } finally {
        startupBundle = null;
      }
    })().finally(() => {
      startPromise = null;
    });

    return startPromise;
  }

  async function shutdown(reason: string): Promise<void> {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      const bundlesToClose = new Set<UserbotClientBundle>();

      if (startupBundle) {
        bundlesToClose.add(startupBundle);
      }
      if (activeBundle) {
        bundlesToClose.add(activeBundle);
      }

      startupBundle = null;
      activeBundle = null;

      for (const bundle of bundlesToClose) {
        await destroyBundle(bundle, reason);
      }

      deps.logger.info(`[userbot] Worker stopped (${reason}).`);
    })().finally(() => {
      shutdownPromise = null;
    });

    return shutdownPromise;
  }

  return {
    shutdown,
    start,
  };
}

export function registerShutdownHandlers(
  worker: { shutdown(reason: string): Promise<void> },
  options: {
    exit?: (code: number) => void;
    logger?: Logger;
    processLike?: ProcessSignalLike;
  } = {}
): void {
  const logger = options.logger ?? console;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const processLike = options.processLike ?? process;

  let hasHandledSignal = false;

  const handleSignal = (signal: SignalName) => {
    if (hasHandledSignal) {
      return;
    }
    hasHandledSignal = true;

    logger.info(`[userbot] Received ${signal}, shutting down...`);
    void worker
      .shutdown(signal)
      .then(() => exit(0))
      .catch((error) => {
        logger.error("[userbot] Shutdown failed", error);
        exit(1);
      });
  };

  processLike.once("SIGINT", () => handleSignal("SIGINT"));
  processLike.once("SIGTERM", () => handleSignal("SIGTERM"));
}

export async function runWorkerCli(
  overrides: Partial<WorkerDeps> = {}
): Promise<number> {
  const logger = overrides.logger ?? console;
  const worker = createUserbotWorker(overrides);
  const loadConfig = overrides.loadConfig ?? loadUserbotConfig;
  const env = overrides.env ?? process.env;

  try {
    registerShutdownHandlers(worker, { logger });
    await worker.start();

    await new Promise<never>(() => {
      // intentionally unresolved; process exits through signal handlers
    });
  } catch (error) {
    let guidance = "Run bun run auth:bootstrap.";
    try {
      guidance = buildReauthGuidance(loadConfig(env));
    } catch {
      // Keep default guidance when config cannot be loaded.
    }
    logger.error(`[userbot] Worker failed to start. ${guidance}`, error);
    await worker.shutdown("startup_error");
    return 1;
  }

  return 0;
}

if (isDirectExecution("worker.ts")) {
  process.exit(await runWorkerCli());
}
