import { beforeAll, afterEach, describe, expect, mock, test } from "bun:test";
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

mock.module("@/features/chat/server/smart-account-resolver", () => ({
  resolveChatUserSmartAccount: async () => null,
}));

mock.module("@/lib/core/analytics-server", () => ({
  trackServerAnalyticsEvent: () => {},
}));

const fakeDbState = {
  users: [] as Array<{
    id: string;
    provider: "solana";
    subjectAddress: string;
    gridUserId: string | null;
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
                  gridUserId: (values.gridUserId as string | null) ?? null,
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
          if (table === appUsers && fakeDbState.users[0]) {
            fakeDbState.users[0] = {
              ...fakeDbState.users[0],
              ...(values.gridUserId !== undefined
                ? { gridUserId: values.gridUserId as string | null }
                : {}),
            };
            return;
          }

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
const originalFetch = globalThis.fetch;

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

describe("chat route", () => {
  beforeAll(async () => {
    ({ POST } = await import("../route"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetFakeDbState();
    delete process.env.PHALA_API_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.NEXT_PUBLIC_GRID_AUTH_BASE_URL;
    delete process.env.NEXT_PUBLIC_APP_ENVIRONMENT;
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

  test("returns 403 when the auth gateway rejects a non-wallet session", async () => {
    process.env.NEXT_PUBLIC_APP_ENVIRONMENT = "prod";
    process.env.PHALA_API_KEY = "test-key";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.NEXT_PUBLIC_GRID_AUTH_BASE_URL = "https://auth.askloyal.com";
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          user: {
            authMethod: "email",
            subjectAddress: "grid-1",
            displayAddress: "grid-1",
            email: "user@example.com",
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }
      )
    ) as typeof fetch;

    const response = await POST(
      new Request("https://app.askloyal.com/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "session=1",
          origin: "https://askloyal.com",
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
        code: "unsupported_auth_method",
        message: "Wallet authentication is required to use chat.",
      },
    });
  });

  test("returns 403 when the auth gateway rejects a mismatched wallet principal", async () => {
    process.env.NEXT_PUBLIC_APP_ENVIRONMENT = "prod";
    process.env.PHALA_API_KEY = "test-key";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.NEXT_PUBLIC_GRID_AUTH_BASE_URL = "https://auth.askloyal.com";
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          user: {
            authMethod: "wallet",
            subjectAddress: "subject-1",
            displayAddress: "wallet-1",
            walletAddress: "wallet-1",
            provider: "solana",
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }
      )
    ) as typeof fetch;

    const response = await POST(
      new Request("https://app.askloyal.com/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "session=1",
          origin: "https://askloyal.com",
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
    process.env.PHALA_API_KEY = "test-key";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.NEXT_PUBLIC_GRID_AUTH_BASE_URL = "https://auth.askloyal.com";
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          user: {
            authMethod: "wallet",
            subjectAddress: "wallet-1",
            displayAddress: "wallet-1",
            walletAddress: "wallet-1",
            provider: "solana",
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }
      )
    ) as typeof fetch;

    const response = await POST(
      new Request("https://app.askloyal.com/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "session=1",
          origin: "https://askloyal.com",
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
        gridUserId: null,
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
  });
});
