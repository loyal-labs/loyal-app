import { createInterface } from "node:readline/promises";

import { createUserbotClient, type UserbotClientBundle } from "../lib/client";
import {
  loadUserbotConfig,
  readBootstrapPhone,
  type UserbotConfig,
} from "../lib/env";
import {
  buildReauthGuidance,
  createBotTokenStartParams,
} from "../lib/non-interactive-auth";

type EnvRecord = Record<string, string | undefined>;

type Logger = Pick<Console, "error" | "info" | "warn">;

type Prompt = {
  ask(question: string): Promise<string>;
};

type AuthBootstrapDeps = {
  createClient: (config: UserbotConfig) => Promise<UserbotClientBundle>;
  createPrompt: () => Prompt;
  env: EnvRecord;
  loadConfig: (env: EnvRecord) => UserbotConfig;
  logger: Logger;
};

function isDirectExecution(scriptName: string): boolean {
  const entrypoint = process.argv[1];
  return typeof entrypoint === "string" && entrypoint.endsWith(scriptName);
}

function createPrompt(): Prompt {
  return {
    ask: async (question: string) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = await rl.question(question);
      rl.close();
      return answer.trim();
    },
  };
}

function resolveDeps(overrides: Partial<AuthBootstrapDeps>): AuthBootstrapDeps {
  return {
    createClient: overrides.createClient ?? createUserbotClient,
    createPrompt: overrides.createPrompt ?? createPrompt,
    env: overrides.env ?? process.env,
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

export async function runAuthBootstrap(
  overrides: Partial<AuthBootstrapDeps> = {}
): Promise<void> {
  const deps = resolveDeps(overrides);
  const config = deps.loadConfig(deps.env);

  deps.logger.info(
    `[userbot] Starting auth bootstrap for account '${config.accountKey}' (authMode=${config.authMode}).`
  );

  const bundle = await deps.createClient(config);
  deps.logger.info(`[userbot] Session storage: ${bundle.sessionPath}`);

  try {
    const user = await (async () => {
      if (config.authMode === "bot") {
        return bundle.client.start(createBotTokenStartParams(config));
      }

      const phoneFromEnv = readBootstrapPhone(deps.env);
      const prompt = deps.createPrompt();
      return bundle.client.start({
        code: async () => prompt.ask("Telegram code: "),
        password: async () => prompt.ask("2FA password (if enabled): "),
        phone: async () => phoneFromEnv ?? prompt.ask("Phone number (+...): "),
      });
    })();

    deps.logger.info(
      `[userbot] Auth bootstrap complete for account '${
        config.accountKey
      }' as ${getIdentityLabel(user)}.`
    );
  } finally {
    await bundle.client.destroy();
  }
}

export async function runAuthBootstrapCli(
  overrides: Partial<AuthBootstrapDeps> = {}
): Promise<number> {
  const logger = overrides.logger ?? console;
  const loadConfig = overrides.loadConfig ?? loadUserbotConfig;
  const env = overrides.env ?? process.env;

  try {
    await runAuthBootstrap(overrides);
    return 0;
  } catch (error) {
    let guidance = "Run bun run auth:bootstrap.";
    try {
      guidance = buildReauthGuidance(loadConfig(env));
    } catch {
      // Keep default guidance when config cannot be loaded.
    }
    logger.error(`[userbot] Auth bootstrap failed. ${guidance}`, error);
    return 1;
  }
}

if (isDirectExecution("auth-bootstrap.ts")) {
  process.exit(await runAuthBootstrapCli());
}
