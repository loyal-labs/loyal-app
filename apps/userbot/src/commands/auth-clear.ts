import { unlink } from "node:fs/promises";

import { loadUserbotConfig, type UserbotConfig } from "../lib/env";
import { resolveSessionSqlitePath } from "../lib/storage";

type EnvRecord = Record<string, string | undefined>;

type Logger = Pick<Console, "error" | "info" | "warn">;

type AuthClearDeps = {
  env: EnvRecord;
  loadConfig: (env: EnvRecord) => UserbotConfig;
  logger: Logger;
  removeFile: (path: string) => Promise<void>;
};

function isDirectExecution(scriptName: string): boolean {
  const entrypoint = process.argv[1];
  return typeof entrypoint === "string" && entrypoint.endsWith(scriptName);
}

function resolveDeps(overrides: Partial<AuthClearDeps>): AuthClearDeps {
  return {
    env: overrides.env ?? process.env,
    loadConfig: overrides.loadConfig ?? loadUserbotConfig,
    logger: overrides.logger ?? console,
    removeFile: overrides.removeFile ?? unlink,
  };
}

export async function runAuthClear(
  overrides: Partial<AuthClearDeps> = {}
): Promise<string[]> {
  const deps = resolveDeps(overrides);
  const config = deps.loadConfig(deps.env);
  const sessionPath = resolveSessionSqlitePath(
    config.accountKey,
    config.storageDir
  );

  const candidates = [
    sessionPath,
    `${sessionPath}-journal`,
    `${sessionPath}-shm`,
    `${sessionPath}-wal`,
  ];

  const removed: string[] = [];

  for (const candidate of candidates) {
    try {
      await deps.removeFile(candidate);
      removed.push(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  deps.logger.info(
    `[userbot] Cleared ${removed.length} session file(s) for '${config.accountKey}'.`
  );
  deps.logger.info(`[userbot] Session base path: ${sessionPath}`);

  return removed;
}

export async function runAuthClearCli(
  overrides: Partial<AuthClearDeps> = {}
): Promise<number> {
  const logger = overrides.logger ?? console;

  try {
    await runAuthClear(overrides);
    return 0;
  } catch (error) {
    logger.error("[userbot] Failed to clear session", error);
    return 1;
  }
}

if (isDirectExecution("auth-clear.ts")) {
  process.exit(await runAuthClearCli());
}
