import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Bot, Context } from "grammy";

import type { WebhookTextMessageHandlerDeps } from "./message-text-handler";

let handleWebhookTextMessage: typeof import("./message-text-handler").handleWebhookTextMessage;

let handleCommunityMessageCalls = 0;
let handleDirectMessageCalls = 0;
let handleGLoyalReactionCalls = 0;
let handleCommunityMessageImpl: WebhookTextMessageHandlerDeps["handleCommunityMessage"];
let handleDirectMessageImpl: WebhookTextMessageHandlerDeps["handleDirectMessage"];
let handleGLoyalReactionImpl: WebhookTextMessageHandlerDeps["handleGLoyalReaction"];

const fakeBot = {} as Bot;

function createDeps(): WebhookTextMessageHandlerDeps {
  return {
    handleCommunityMessage: async (ctx) => {
      handleCommunityMessageCalls += 1;
      await handleCommunityMessageImpl(ctx);
    },
    handleDirectMessage: async (ctx, bot) => {
      handleDirectMessageCalls += 1;
      await handleDirectMessageImpl(ctx, bot);
    },
    handleGLoyalReaction: async (ctx, bot) => {
      handleGLoyalReactionCalls += 1;
      await handleGLoyalReactionImpl(ctx, bot);
    },
    isPrivateChat: (chatType) => chatType === "private",
  };
}

function createCommunityContext(): Context {
  return {
    chat: {
      id: -1001234567890,
      type: "supergroup",
    },
    message: {
      message_id: 1234,
      text: "hello group",
    },
    update: {
      update_id: 123,
    },
  } as unknown as Context;
}

describe("webhook text message handler", () => {
  beforeAll(async () => {
    const loadedModule = await import("./message-text-handler");
    handleWebhookTextMessage = loadedModule.handleWebhookTextMessage;
  });

  beforeEach(() => {
    handleCommunityMessageCalls = 0;
    handleDirectMessageCalls = 0;
    handleGLoyalReactionCalls = 0;
    handleCommunityMessageImpl = async () => {};
    handleDirectMessageImpl = async () => {};
    handleGLoyalReactionImpl = async () => {};
  });

  test("rejects when community ingest fails", async () => {
    const ingestFailure = new Error("ingest failed");
    handleCommunityMessageImpl = async () => {
      throw ingestFailure;
    };
    const context = createCommunityContext();

    await expect(
      handleWebhookTextMessage(context, fakeBot, createDeps())
    ).rejects.toThrow("ingest failed");

    expect(handleCommunityMessageCalls).toBe(1);
    expect(handleGLoyalReactionCalls).toBe(0);
  });

  test("continues successfully when reaction handling fails", async () => {
    handleGLoyalReactionImpl = async () => {
      throw new Error("reaction failed");
    };
    const context = createCommunityContext();

    const previousConsoleError = console.error;
    const consoleErrorCalls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      consoleErrorCalls.push(args);
    };

    try {
      await expect(
        handleWebhookTextMessage(context, fakeBot, createDeps())
      ).resolves.toBeUndefined();
      await Promise.resolve();
    } finally {
      console.error = previousConsoleError;
    }

    expect(handleCommunityMessageCalls).toBe(1);
    expect(handleGLoyalReactionCalls).toBe(1);
    expect(consoleErrorCalls).toHaveLength(1);
    expect(consoleErrorCalls[0]?.[0]).toBe("Failed to handle gLoyal reaction");
    expect(consoleErrorCalls[0]?.[2]).toBeInstanceOf(Error);
  });

  test("does not await slow reaction handling before resolving", async () => {
    let resolveReaction: (() => void) | null = null;
    let reactionSettled = false;

    handleGLoyalReactionImpl = async () => {
      await new Promise<void>((resolve) => {
        resolveReaction = resolve;
      });
      reactionSettled = true;
    };

    const context = createCommunityContext();
    await expect(
      handleWebhookTextMessage(context, fakeBot, createDeps())
    ).resolves.toBeUndefined();

    expect(handleCommunityMessageCalls).toBe(1);
    expect(handleGLoyalReactionCalls).toBe(1);
    expect(reactionSettled).toBe(false);

    resolveReaction?.();
    await Promise.resolve();
    expect(reactionSettled).toBe(true);
  });

  test("routes private non-command text to direct-message handler", async () => {
    const privateContext = {
      chat: {
        id: 777,
        type: "private",
      },
      message: {
        message_id: 77,
        text: "hello bot",
      },
      update: {
        update_id: 124,
      },
    } as unknown as Context;

    await handleWebhookTextMessage(privateContext, fakeBot, createDeps());

    expect(handleDirectMessageCalls).toBe(1);
    expect(handleCommunityMessageCalls).toBe(0);
    expect(handleGLoyalReactionCalls).toBe(0);
  });
});
