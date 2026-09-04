import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { runAuthBootstrap } from "../commands/auth-bootstrap";
import { runAuthClear } from "../commands/auth-clear";
import { runAuthStatus } from "../commands/auth-status";
import type { UserbotConfig } from "../lib/env";

type FakeLogger = {
  error: (..._args: unknown[]) => void;
  info: (..._args: unknown[]) => void;
  warn: (..._args: unknown[]) => void;
};

function createLogger(): FakeLogger {
  return {
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  };
}

function createConfig(
  storageDir: string,
  overrides: Partial<UserbotConfig> = {}
): UserbotConfig {
  return {
    accountKey: "primary",
    authMode: "user",
    apiHash: "hash",
    apiId: 123,
    botToken: null,
    storageDir,
    ...overrides,
  };
}

describe("auth command primitives", () => {
  test("auth-bootstrap succeeds and destroys client", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "userbot-bootstrap-"));
    const sessionPath = join(storageDir, "mtcute-primary.sqlite");

    let destroyCalls = 0;

    try {
      await runAuthBootstrap({
        createClient: async (config) => ({
          config,
          sessionPath,
          client: {
            destroy: async () => {
              destroyCalls += 1;
            },
            start: async () => {
              await writeFile(sessionPath, "sqlite");
              return { id: 999n, username: "test_user" };
            },
          } as any,
        }),
        createPrompt: () => ({
          ask: async () => "noop",
          close: () => undefined,
        }),
        loadConfig: () => createConfig(storageDir),
        logger: createLogger(),
      });

      await stat(sessionPath);
      expect(destroyCalls).toBe(1);
    } finally {
      await rm(storageDir, { force: true, recursive: true });
    }
  });

  test("auth-bootstrap failure still destroys client", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "userbot-bootstrap-fail-"));

    let destroyCalls = 0;

    try {
      await expect(
        runAuthBootstrap({
          createClient: async (config) => ({
            config,
            sessionPath: join(storageDir, "mtcute-primary.sqlite"),
            client: {
              destroy: async () => {
                destroyCalls += 1;
              },
              start: async () => {
                throw new Error("invalid code");
              },
            } as any,
          }),
          createPrompt: () => ({
            ask: async () => "noop",
            close: () => undefined,
          }),
          loadConfig: () => createConfig(storageDir),
          logger: createLogger(),
        })
      ).rejects.toThrow("invalid code");

      expect(destroyCalls).toBe(1);
    } finally {
      await rm(storageDir, { force: true, recursive: true });
    }
  });

  test("auth-bootstrap uses bot token mode without interactive prompts", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "userbot-bootstrap-bot-"));
    const sessionPath = join(storageDir, "mtcute-primary.sqlite");

    let promptCreated = false;
    let receivedBotToken = "";

    try {
      await runAuthBootstrap({
        createClient: async (config) => ({
          config,
          sessionPath,
          client: {
            destroy: async () => undefined,
            start: async (params?: { botToken?: string }) => {
              receivedBotToken = params?.botToken ?? "";
              await writeFile(sessionPath, "sqlite");
              return { id: 321n, username: "askloyal_bot" };
            },
          } as any,
        }),
        createPrompt: () => {
          promptCreated = true;
          return {
            ask: async () => "noop",
            close: () => undefined,
          };
        },
        loadConfig: () =>
          createConfig(storageDir, {
            authMode: "bot",
            botToken: "bot-token-123",
          }),
        logger: createLogger(),
      });

      expect(promptCreated).toBe(false);
      expect(receivedBotToken).toBe("bot-token-123");
    } finally {
      await rm(storageDir, { force: true, recursive: true });
    }
  });

  test("auth-status returns false quickly when session file is missing", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "userbot-status-missing-"));

    let createClientCalls = 0;

    try {
      const authenticated = await runAuthStatus({
        createClient: async (config) => {
          createClientCalls += 1;
          return {
            config,
            sessionPath: join(storageDir, "mtcute-primary.sqlite"),
            client: {
              destroy: async () => undefined,
              start: async () => ({ id: 1 }),
            } as any,
          };
        },
        loadConfig: () => createConfig(storageDir),
        logger: createLogger(),
      });

      expect(authenticated).toBe(false);
      expect(createClientCalls).toBe(0);
    } finally {
      await rm(storageDir, { force: true, recursive: true });
    }
  });

  test("auth-status uses non-interactive callbacks for invalid sessions", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "userbot-status-invalid-"));
    const sessionPath = join(storageDir, "mtcute-primary.sqlite");

    let callbackErrorMessage = "";

    try {
      await writeFile(sessionPath, "sqlite");

      const authenticated = await runAuthStatus({
        createClient: async (config) => ({
          config,
          sessionPath,
          client: {
            destroy: async () => undefined,
            start: async (params?: { phone?: () => Promise<string> }) => {
              if (params?.phone) {
                try {
                  await params.phone();
                } catch (error) {
                  callbackErrorMessage =
                    error instanceof Error ? error.message : String(error);
                }
              }
              throw new Error("session invalid");
            },
          } as any,
        }),
        loadConfig: () => createConfig(storageDir),
        logger: createLogger(),
      });

      expect(authenticated).toBe(false);
      expect(callbackErrorMessage).toContain("Run bun run auth:bootstrap");
    } finally {
      await rm(storageDir, { force: true, recursive: true });
    }
  });

  test("auth-clear removes only targeted account session files", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "userbot-clear-"));
    const basePath = join(storageDir, "mtcute-primary.sqlite");
    const siblingPath = join(storageDir, "mtcute-other.sqlite");

    try {
      await writeFile(basePath, "db");
      await writeFile(`${basePath}-wal`, "wal");
      await writeFile(`${basePath}-shm`, "shm");
      await writeFile(siblingPath, "other");

      const removed = await runAuthClear({
        loadConfig: () => createConfig(storageDir),
        logger: createLogger(),
      });

      expect(removed).toContain(basePath);
      expect(removed).toContain(`${basePath}-wal`);
      expect(removed).toContain(`${basePath}-shm`);

      await expect(stat(basePath)).rejects.toThrow();
      await expect(stat(`${basePath}-wal`)).rejects.toThrow();
      await expect(stat(`${basePath}-shm`)).rejects.toThrow();
      await stat(siblingPath);
    } finally {
      await rm(storageDir, { force: true, recursive: true });
    }
  });

  test("auth-status in bot mode can validate token login without session file", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "userbot-status-bot-"));

    let createClientCalls = 0;
    let receivedBotToken = "";

    try {
      const authenticated = await runAuthStatus({
        createClient: async (config) => {
          createClientCalls += 1;
          return {
            config,
            sessionPath: join(storageDir, "mtcute-primary.sqlite"),
            client: {
              destroy: async () => undefined,
              start: async (params?: { botToken?: string }) => {
                receivedBotToken = params?.botToken ?? "";
                return { id: 1 };
              },
            } as any,
          };
        },
        loadConfig: () =>
          createConfig(storageDir, {
            authMode: "bot",
            botToken: "bot-token-456",
          }),
        logger: createLogger(),
      });

      expect(authenticated).toBe(true);
      expect(createClientCalls).toBe(1);
      expect(receivedBotToken).toBe("bot-token-456");
    } finally {
      await rm(storageDir, { force: true, recursive: true });
    }
  });
});
