import { EventEmitter } from "node:events";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createUserbotWorker, registerShutdownHandlers } from "../worker";
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

function createConfig(overrides: Partial<UserbotConfig> = {}): UserbotConfig {
  return {
    accountKey: "primary",
    authMode: "user",
    apiHash: "hash",
    apiId: 123,
    botToken: null,
    storageDir: "/tmp/userbot",
    ...overrides,
  };
}

describe("worker runtime", () => {
  test("fails fast when session file is missing", async () => {
    let createClientCalls = 0;

    const worker = createUserbotWorker({
      createClient: async (config) => {
        createClientCalls += 1;
        return {
          config,
          sessionPath: join(config.storageDir, "mtcute-primary.sqlite"),
          client: {
            destroy: async () => undefined,
            onRawUpdate: { add: () => undefined },
            start: async () => ({ id: 1 }),
          } as any,
        };
      },
      hasFile: async () => false,
      loadConfig: () => createConfig(),
      logger: createLogger(),
    });

    await expect(worker.start()).rejects.toThrow("Missing session file");
    expect(createClientCalls).toBe(0);
  });

  test("startup error destroys created client", async () => {
    let destroyCalls = 0;

    const worker = createUserbotWorker({
      createClient: async (config) => ({
        config,
        sessionPath: join(config.storageDir, "mtcute-primary.sqlite"),
        client: {
          destroy: async () => {
            destroyCalls += 1;
          },
          onRawUpdate: { add: () => undefined },
          start: async () => {
            throw new Error("invalid session");
          },
        } as any,
      }),
      hasFile: async () => true,
      loadConfig: () => createConfig(),
      logger: createLogger(),
    });

    await expect(worker.start()).rejects.toThrow("invalid session");
    expect(destroyCalls).toBe(1);
  });

  test("worker start uses non-interactive auth callbacks", async () => {
    let callbackErrorMessage = "";

    const worker = createUserbotWorker({
      createClient: async (config) => ({
        config,
        sessionPath: join(config.storageDir, "mtcute-primary.sqlite"),
        client: {
          destroy: async () => undefined,
          onRawUpdate: { add: () => undefined },
          start: async (params?: { phone?: () => Promise<string> }) => {
            if (params?.phone) {
              try {
                await params.phone();
              } catch (error) {
                callbackErrorMessage =
                  error instanceof Error ? error.message : String(error);
              }
            }
            throw new Error("invalid session");
          },
        } as any,
      }),
      hasFile: async () => true,
      loadConfig: () => createConfig(),
      logger: createLogger(),
    });

    await expect(worker.start()).rejects.toThrow("invalid session");
    expect(callbackErrorMessage).toContain("Run bun run auth:bootstrap");
  });

  test("bot mode starts without pre-existing session file", async () => {
    let receivedBotToken = "";

    const worker = createUserbotWorker({
      createClient: async (config) => ({
        config,
        sessionPath: join(config.storageDir, "mtcute-primary.sqlite"),
        client: {
          destroy: async () => undefined,
          onRawUpdate: { add: () => undefined },
          start: async (params?: { botToken?: string }) => {
            receivedBotToken = params?.botToken ?? "";
            return { id: 999 };
          },
        } as any,
      }),
      hasFile: async () => false,
      loadConfig: () =>
        createConfig({
          authMode: "bot",
          botToken: "bot-token-789",
        }),
      logger: createLogger(),
    });

    await expect(worker.start()).resolves.toBeUndefined();
    expect(receivedBotToken).toBe("bot-token-789");
  });

  test("shutdown handler is idempotent across repeated signals", async () => {
    let destroyCalls = 0;
    let exitCalls = 0;

    const fakeProcess = new EventEmitter() as EventEmitter & {
      once: (event: string, handler: () => void) => EventEmitter;
    };

    const worker = createUserbotWorker({
      createClient: async (config) => ({
        config,
        sessionPath: join(config.storageDir, "mtcute-primary.sqlite"),
        client: {
          destroy: async () => {
            destroyCalls += 1;
          },
          onRawUpdate: { add: () => undefined },
          start: async () => ({ id: 7 }),
        } as any,
      }),
      hasFile: async () => true,
      loadConfig: () => createConfig(),
      logger: createLogger(),
    });

    await worker.start();

    registerShutdownHandlers(worker, {
      exit: () => {
        exitCalls += 1;
      },
      logger: createLogger(),
      processLike: fakeProcess,
    });

    fakeProcess.emit("SIGTERM");
    fakeProcess.emit("SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(destroyCalls).toBe(1);
    expect(exitCalls).toBe(1);
  });

  test("signal during startup still destroys startup bundle", async () => {
    let destroyCalls = 0;
    let exitCalls = 0;

    const fakeProcess = new EventEmitter() as EventEmitter & {
      once: (event: string, handler: () => void) => EventEmitter;
    };

    const worker = createUserbotWorker({
      createClient: async (config) => ({
        config,
        sessionPath: join(config.storageDir, "mtcute-primary.sqlite"),
        client: {
          destroy: async () => {
            destroyCalls += 1;
          },
          onRawUpdate: { add: () => undefined },
          start: async () => new Promise(() => undefined),
        } as any,
      }),
      hasFile: async () => true,
      loadConfig: () => createConfig(),
      logger: createLogger(),
    });

    registerShutdownHandlers(worker, {
      exit: () => {
        exitCalls += 1;
      },
      logger: createLogger(),
      processLike: fakeProcess,
    });

    void worker.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    fakeProcess.emit("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(destroyCalls).toBe(1);
    expect(exitCalls).toBe(1);
  });
});
