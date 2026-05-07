import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import {
  appChatMessages,
  appChats,
  appUserWallets,
  appUsers,
} from "@loyal-labs/db-core/schema";

mock.module("server-only", () => ({}));

mock.module("@loyal-labs/llm-core", () => ({
  resolveLlmProviderConfig: () => ({
    config: {
      apiKey: "test-key",
      apiURL: "https://api.redpill.ai/v1/",
      headers: {},
    },
    model: "loyal-oracle",
  }),
}));

mock.module("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: () => ({
    languageModel: () => ({ provider: "mock" }),
  }),
}));

mock.module("ai", () => ({
  convertToModelMessages: (messages: unknown) => messages,
  streamText: () => ({
    async toUIMessageStreamResponse({
      onFinish,
    }: {
      onFinish?: (args: {
        isAborted: boolean;
        responseMessage: {
          id: string;
          role: "assistant";
          parts: [{ type: "text"; text: string }];
        };
      }) => Promise<void>;
    }) {
      await onFinish?.({
        isAborted: false,
        responseMessage: {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Hi there" }],
        },
      });
      return new Response("ok");
    },
  }),
}));

const trackServerAnalyticsEvent = mock(() => {});
mock.module("@/lib/core/analytics-server", () => ({
  trackServerAnalyticsEvent,
}));

const fakeDbState = {
  users: [] as Array<{
    id: string;
    provider: "solana";
    subjectAddress: string;
  }>,
  wallets: [] as Array<{
    userId: string;
    walletAddress: string;
  }>,
  chats: [] as Array<{
    id: string;
    userId: string;
    clientChatId: string | null;
    title: string | null;
    model: string;
    updatedAt: Date;
    lastMessageAt: Date | null;
  }>,
  messages: [] as Array<{
    id: string;
    chatId: string;
    role: "user" | "assistant";
    content: string;
    clientMessageId: string | null;
    turnId: string | null;
  }>,
};

function resetFakeDbState() {
  fakeDbState.users = [];
  fakeDbState.wallets = [];
  fakeDbState.chats = [];
  fakeDbState.messages = [];
}

function createInsertBuilder(table: unknown) {
  return {
    values(values: Record<string, unknown>) {
      if (table === appUsers) {
        return {
          onConflictDoNothing() {
            return {
              returning() {
                if (fakeDbState.users[0]) {
                  return [];
                }

                const row = {
                  id: "user-1",
                  provider: values.provider as "solana",
                  subjectAddress: values.subjectAddress as string,
                };
                fakeDbState.users.push(row);
                return [row];
              },
            };
          },
        };
      }

      if (table === appUserWallets) {
        return {
          async onConflictDoUpdate() {
            fakeDbState.wallets = [
              {
                userId: values.userId as string,
                walletAddress: values.walletAddress as string,
              },
            ];
          },
        };
      }

      if (table === appChats) {
        return {
          onConflictDoNothing() {
            return {
              returning() {
                const existingChat = fakeDbState.chats.find(
                  (chat) => chat.clientChatId === values.clientChatId
                );
                if (existingChat) {
                  return [];
                }

                const row = {
                  id: "chat-1",
                  userId: values.userId as string,
                  clientChatId: (values.clientChatId as string | null) ?? null,
                  title: (values.title as string | null) ?? null,
                  model: values.model as string,
                  updatedAt: values.updatedAt as Date,
                  lastMessageAt: null,
                };
                fakeDbState.chats.push(row);
                return [{ id: row.id, title: row.title }];
              },
            };
          },
        };
      }

      if (table === appChatMessages) {
        const insertMessage = () => {
          const row = {
            id: `message-${fakeDbState.messages.length + 1}`,
            chatId: values.chatId as string,
            role: values.role as "user" | "assistant",
            content: values.content as string,
            clientMessageId: (values.clientMessageId as string | null) ?? null,
            turnId: (values.turnId as string | null) ?? null,
          };
          fakeDbState.messages.push(row);
          return [{ id: row.id }];
        };

        return {
          returning: async () => insertMessage(),
          onConflictDoNothing() {
            return {
              async returning() {
                const existingMessage = fakeDbState.messages.find((message) => {
                  if (
                    message.chatId !== values.chatId ||
                    message.role !== values.role
                  ) {
                    return false;
                  }

                  if (values.role === "user") {
                    return (
                      values.clientMessageId !== undefined &&
                      message.clientMessageId === values.clientMessageId
                    );
                  }

                  return (
                    values.turnId !== undefined && message.turnId === values.turnId
                  );
                });

                if (existingMessage) {
                  return [];
                }

                return insertMessage();
              },
            };
          },
        };
      }

      throw new Error("Unexpected table insert");
    },
  };
}

function createUpdateBuilder(table: unknown) {
  return {
    set(values: Record<string, unknown>) {
      return {
        async where() {
          if (table === appChats && fakeDbState.chats[0]) {
            fakeDbState.chats[0] = {
              ...fakeDbState.chats[0],
              ...(values.title !== undefined
                ? { title: values.title as string | null }
                : {}),
              ...(values.updatedAt !== undefined
                ? { updatedAt: values.updatedAt as Date }
                : {}),
              ...(values.lastMessageAt !== undefined
                ? { lastMessageAt: values.lastMessageAt as Date | null }
                : {}),
            };
          }
        },
      };
    },
  };
}

mock.module("@/lib/core/database", () => ({
  getDatabase: () => ({
    query: {
      appUsers: {
        findFirst: async () => fakeDbState.users[0] ?? null,
      },
      appChats: {
        findFirst: async () =>
          fakeDbState.chats[0]
            ? {
                id: fakeDbState.chats[0].id,
                title: fakeDbState.chats[0].title,
              }
            : null,
      },
    },
    insert: (table: unknown) => createInsertBuilder(table),
    update: (table: unknown) => createUpdateBuilder(table),
  }),
}));

let POST: typeof import("../route").POST;

function createRequest() {
  return new Request("https://app.askloyal.com/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: "chat-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
      ],
    }),
  });
}

async function createWalletSessionCookie(
  claims: {
    authMethod: "wallet";
    subjectAddress: string;
    displayAddress: string;
    provider: "solana";
    walletAddress: string;
    smartAccountAddress: string;
    settingsPda: string;
  }
) {
  const { issueAuthSessionToken } = await import(
    "@/features/identity/server/session-token"
  );
  const token = await issueAuthSessionToken(
    claims,
    process.env.AUTH_JWT_SECRET!,
    60 * 60
  );

  return `loyal_wallet_session=${token}`;
}

describe("chat route", () => {
  beforeAll(async () => {
    process.env.PHALA_API_KEY = "test-key";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.AUTH_JWT_SECRET = "chat-auth-secret";
    ({ POST } = await import("../route"));
  });

  afterEach(() => {
    resetFakeDbState();
    trackServerAnalyticsEvent.mockClear();
    process.env.NEXT_PUBLIC_APP_ENVIRONMENT = "prod";
  });

  test("returns 401 when the auth session is missing", async () => {
    process.env.NEXT_PUBLIC_APP_ENVIRONMENT = "prod";

    const response = await POST(createRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "unauthenticated",
        message: "Authentication is required to use chat.",
      },
    });
  });

  test("returns 403 when the auth gateway rejects a wallet session", async () => {
    process.env.NEXT_PUBLIC_APP_ENVIRONMENT = "prod";
    const cookie = await createWalletSessionCookie({
      authMethod: "wallet",
      subjectAddress: "subject-1",
      displayAddress: "wallet-1",
      provider: "solana",
      walletAddress: "wallet-1",
      smartAccountAddress: "smart-account-1",
      settingsPda: "settings-1",
    });

    const response = await POST(
      new Request("https://app.askloyal.com/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          id: "chat-1",
          messages: [
            {
              id: "user-1",
              role: "user",
              parts: [{ type: "text", text: "Hello" }],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_wallet_principal",
        message:
          "Wallet sessions must use the same subject and wallet address for chat.",
      },
    });
  });

  test("derives a stable turn id and persists an assistant reply on the happy path", async () => {
    process.env.NEXT_PUBLIC_APP_ENVIRONMENT = "prod";
    const cookie = await createWalletSessionCookie({
      authMethod: "wallet",
      subjectAddress: "wallet-1",
      displayAddress: "wallet-1",
      provider: "solana",
      walletAddress: "wallet-1",
      smartAccountAddress: "smart-account-1",
      settingsPda: "settings-1",
    });

    const response = await POST(
      new Request("https://app.askloyal.com/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          id: "chat-1",
          messageId: "turn-1",
          messages: [
            {
              id: "user-1",
              role: "user",
              parts: [{ type: "text", text: "Hello" }],
            },
          ],
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(fakeDbState.users).toEqual([
      {
        id: "user-1",
        provider: "solana",
        subjectAddress: "wallet-1",
      },
    ]);
    expect(fakeDbState.wallets).toEqual([
      {
        userId: "user-1",
        walletAddress: "wallet-1",
      },
    ]);
    expect(fakeDbState.chats).toEqual([
      expect.objectContaining({
        id: "chat-1",
        userId: "user-1",
        clientChatId: "chat-1",
        title: "Hello",
      }),
    ]);
    expect(fakeDbState.messages).toEqual([
      {
        id: "message-1",
        chatId: "chat-1",
        role: "user",
        content: "Hello",
        clientMessageId: "user-1",
        turnId: "turn-1",
      },
      {
        id: "message-2",
        chatId: "chat-1",
        role: "assistant",
        content: "Hi there",
        clientMessageId: null,
        turnId: "turn-1",
      },
    ]);
    expect(trackServerAnalyticsEvent).toHaveBeenCalledWith(
      "chat_thread_created",
      expect.objectContaining({
        distinct_id: "wallet:wallet-1",
        smart_account_address: "smart-account-1",
        settings_pda: "settings-1",
      })
    );
  });
});
