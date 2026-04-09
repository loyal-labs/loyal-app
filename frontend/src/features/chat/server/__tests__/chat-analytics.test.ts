import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const trackServerAnalyticsEvent = mock();

mock.module("@/lib/core/analytics-server", () => ({
  trackServerAnalyticsEvent,
}));

let trackChatThreadCreatedServer: typeof import("../chat-analytics").trackChatThreadCreatedServer;

describe("chat analytics", () => {
  beforeAll(async () => {
    ({ trackChatThreadCreatedServer } = await import("../chat-analytics"));
  });

  beforeEach(() => {
    trackServerAnalyticsEvent.mockClear();
  });

  test("tracks new chat threads with wallet identity", () => {
    trackChatThreadCreatedServer({
      principal: {
        provider: "solana",
        authMethod: "wallet",
        subjectAddress: "wallet-address",
        walletAddress: "wallet-address",
        gridUserId: "grid-user-1",
      },
      smartAccountAddress: "smart-account-1",
      chatId: "chat-123",
      initialMessageLength: 21,
      source: "main_chat_input",
      clientIp: "203.0.113.10",
    });

    expect(trackServerAnalyticsEvent).toHaveBeenCalledWith(
      "chat_thread_created",
      {
        distinct_id: "wallet:wallet-address",
        ip: "203.0.113.10",
        auth_method: "wallet",
        provider: "solana",
        wallet_address: "wallet-address",
        grid_user_id: "grid-user-1",
        smart_account_address: "smart-account-1",
        chat_id: "chat-123",
        source: "main_chat_input",
        initial_message_length: 21,
      }
    );
  });
});
