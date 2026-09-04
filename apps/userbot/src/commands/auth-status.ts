import { stat } from "node:fs/promises";

import { createUserbotClient, type UserbotClientBundle } from "../lib/client";
import { loadUserbotConfig, type UserbotConfig } from "../lib/env";
import {
  buildReauthGuidance,
  createNonInteractiveStartParams,
} from "../lib/non-interactive-auth";
import { resolveSessionSqlitePath } from "../lib/storage";

type EnvRecord = Record<string, string | undefined>;

type Logger = Pick<Console, "error" | "info" | "warn">;

type AuthStatusDeps = {
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

function resolveDeps(overrides: Partial<AuthStatusDeps>): AuthStatusDeps {
  return {
    createClient: overrides.createClient ?? createUserbotClient,
    env: overrides.env ?? process.env,
    hasFile: overrides.hasFile ?? hasFile,
    loadConfig: overrides.loadConfig ?? loadUserbotConfig,
    logger: overrides.logger ?? console,
  };
}

export async function runAuthStatus(
  overrides: Partial<AuthStatusDeps> = {}
): Promise<boolean> {
  const deps = resolveDeps(overrides);
  const config = deps.loadConfig(deps.env);
  deps.logger.info(
    `[userbot] Checking auth status for '${config.accountKey}' (authMode=${config.authMode}).`
  );
  const sessionPath = resolveSessionSqlitePath(
    config.accountKey,
    config.storageDir
  );

  const sessionExists = await deps.hasFile(sessionPath);
  if (!sessionExists && config.authMode === "user") {
    deps.logger.info(
      `[userbot] No session found for '${config.accountKey}'. Run auth:bootstrap first.`
    );
    deps.logger.info(`[userbot] Expected session file: ${sessionPath}`);
    return false;
  }

  if (!sessionExists && config.authMode === "bot") {
    deps.logger.info(
      `[userbot] No session found for '${config.accountKey}' in bot mode; validating token login directly.`
    );
  }

  const bundle = await deps.createClient(config);

  try {
    await bundle.client.start(createNonInteractiveStartParams(config));

    deps.logger.info(
      `[userbot] Session is valid for account '${config.accountKey}' (authMode=${config.authMode}).`
    );

    return true;
  } catch (error) {
    deps.logger.error(
      `[userbot] Session check failed for '${
        config.accountKey
      }'. ${buildReauthGuidance(config)}`,
      error
    );
    return false;
  } finally {
    await bundle.client.destroy();
  }
}

export async function runAuthStatusCli(
  overrides: Partial<AuthStatusDeps> = {}
): Promise<number> {
  const logger = overrides.logger ?? console;

  try {
    return (await runAuthStatus(overrides)) ? 0 : 1;
  } catch (error) {
    logger.error("[userbot] Auth status check crashed", error);
    return 1;
  }
}

if (isDirectExecution("auth-status.ts")) {
  process.exit(await runAuthStatusCli());
}
