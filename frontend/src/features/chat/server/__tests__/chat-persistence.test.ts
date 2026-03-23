import { beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let deriveChatTitle: typeof import("../chat-persistence").deriveChatTitle;
let openOrCreateChat: typeof import("../chat-persistence").openOrCreateChat;
let recordAssistantReply: typeof import("../chat-persistence").recordAssistantReply;
let recordSubmittedUserMessage: typeof import("../chat-persistence").recordSubmittedUserMessage;

type StoredChat = {
  id: string;
  userId: string;
  clientChatId: string | null;
  title: string | null;
  model: string;
  updatedAt: Date;
  lastMessageAt: Date | null;
};

type StoredMessage = {
  chatId: string;
  role: "user" | "assistant";
  content: string;
  clientMessageId: string | null;
  turnId: string | null;
};

describe("chat persistence", () => {
  beforeAll(async () => {
    ({
      deriveChatTitle,
      openOrCreateChat,
      recordAssistantReply,
      recordSubmittedUserMessage,
    } = await import("../chat-persistence"));
  });

  function createFakeDependencies() {
    const chats: StoredChat[] = [];
    const messages: StoredMessage[] = [];
    let chatCounter = 0;
    let nowCounter = 0;

    return {
      chats,
      messages,
      dependencies: {
        now: () => new Date(`2026-03-12T00:00:0${nowCounter++}Z`),
        findChatByClientId: async (userId: string, clientChatId: string) =>
          chats.find(
            (chat) => chat.userId === userId && chat.clientChatId === clientChatId
          ) ?? null,
        createChat: async ({
          userId,
          clientChatId,
          title,
          model,
          now,
        }: StoredChat & { now: Date }) => {
          const chat: StoredChat = {
            id: `chat-${++chatCounter}`,
            userId,
            clientChatId,
            title,
            model,
            updatedAt: now,
            lastMessageAt: null,
          };
          chats.push(chat);
          return { id: chat.id, title: chat.title };
        },
        setChatTitleIfMissing: async ({
          chatId,
          title,
          now,
        }: {
          chatId: string;
          title: string;
          now: Date;
        }) => {
          const chat = chats.find((candidate) => candidate.id === chatId);
          if (!chat || chat.title) {
            return;
          }

          chat.title = title;
          chat.updatedAt = now;
        },
        insertUserMessage: async ({
          chatId,
          content,
          turnId,
          clientMessageId,
        }: StoredMessage & { now: Date }) => {
          const existingMessage =
            clientMessageId === null
              ? null
              : messages.find(
                  (message) =>
                    message.chatId === chatId &&
                    message.clientMessageId === clientMessageId
                );
          if (existingMessage) {
            return false;
          }

          messages.push({
            chatId,
            role: "user",
            content,
            clientMessageId,
            turnId,
          });
          return true;
        },
        insertAssistantMessage: async ({
          chatId,
          content,
          turnId,
        }: {
          chatId: string;
          content: string;
          turnId: string;
          now: Date;
        }) => {
          const existingMessage = messages.find(
            (message) =>
              message.chatId === chatId &&
              message.role === "assistant" &&
              message.turnId === turnId
          );
          if (existingMessage) {
            return false;
          }

          messages.push({
            chatId,
            role: "assistant",
            content,
            clientMessageId: null,
            turnId,
          });
          return true;
        },
        touchChatActivity: async (chatId: string, now: Date) => {
          const chat = chats.find((candidate) => candidate.id === chatId);
          if (!chat) {
            throw new Error("Chat not found");
          }

          chat.updatedAt = now;
          chat.lastMessageAt = now;
        },
      },
    };
  }

  test("derives a compact title from the first user prompt", () => {
    expect(deriveChatTitle("  Explain   this   wallet activity  ")).toBe(
      "Explain this wallet activity"
    );
  });

  test("creates and then reuses the same chat for a client chat id", async () => {
    const { chats, dependencies } = createFakeDependencies();

    const firstChat = await openOrCreateChat(
      {
        userId: "user-1",
        clientChatId: "client-chat-1",
        model: "loyal-oracle",
        firstPrompt: "First prompt",
      },
      dependencies
    );
    const secondChat = await openOrCreateChat(
      {
        userId: "user-1",
        clientChatId: "client-chat-1",
        model: "updated-model",
        firstPrompt: "Updated title should not replace existing one",
      },
      dependencies
    );

    expect(firstChat.created).toBe(true);
    expect(secondChat.created).toBe(false);
    expect(firstChat.id).toBe(secondChat.id);
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({
      title: "First prompt",
      model: "loyal-oracle",
    });
  });

  test("persists the first user request and assistant reply for a chat", async () => {
    const { chats, messages, dependencies } = createFakeDependencies();
    const chat = await openOrCreateChat(
      {
        userId: "user-1",
        clientChatId: "client-chat-1",
        model: "loyal-oracle",
        firstPrompt: "What happened?",
      },
      dependencies
    );

    expect(chat.created).toBe(true);
    const userInserted = await recordSubmittedUserMessage(
      {
        chatId: chat.id,
        content: "What happened?",
        turnId: "turn-1",
        clientMessageId: "user-1",
      },
      dependencies
    );
    const assistantInserted = await recordAssistantReply(
      {
        chatId: chat.id,
        content: "Here is what happened.",
        turnId: "turn-1",
      },
      dependencies
    );

    expect(userInserted).toBe(true);
    expect(assistantInserted).toBe(true);
    expect(chats[0]?.lastMessageAt?.toISOString()).toBe(
      "2026-03-12T00:00:02.000Z"
    );
    expect(messages).toEqual([
      {
        chatId: chat.id,
        role: "user",
        content: "What happened?",
        clientMessageId: "user-1",
        turnId: "turn-1",
      },
      {
        chatId: chat.id,
        role: "assistant",
        content: "Here is what happened.",
        clientMessageId: null,
        turnId: "turn-1",
      },
    ]);
  });

  test("keeps repeated user submissions idempotent by client message id", async () => {
    const { chats, messages, dependencies } = createFakeDependencies();
    const chat = await openOrCreateChat(
      {
        userId: "user-1",
        clientChatId: "client-chat-1",
        model: "loyal-oracle",
        firstPrompt: "Repeat me once",
      },
      dependencies
    );

    expect(chat.created).toBe(true);
    await recordSubmittedUserMessage(
      {
        chatId: chat.id,
        content: "Repeat me once",
        turnId: "turn-1",
        clientMessageId: "user-1",
      },
      dependencies
    );
    await recordSubmittedUserMessage(
      {
        chatId: chat.id,
        content: "Repeat me once",
        turnId: "turn-1",
        clientMessageId: "user-1",
      },
      dependencies
    );

    expect(messages).toHaveLength(1);
    expect(chats[0]?.lastMessageAt?.toISOString()).toBe(
      "2026-03-12T00:00:01.000Z"
    );
  });

  test("ignores empty assistant payloads so failed streams do not create blank rows", async () => {
    const { chats, messages, dependencies } = createFakeDependencies();
    const chat = await openOrCreateChat(
      {
        userId: "user-1",
        clientChatId: "client-chat-1",
        model: "loyal-oracle",
        firstPrompt: "First prompt",
      },
      dependencies
    );

    expect(chat.created).toBe(true);
    const inserted = await recordAssistantReply(
      {
        chatId: chat.id,
        content: "   ",
        turnId: "turn-1",
      },
      dependencies
    );

    expect(inserted).toBe(false);
    expect(messages).toHaveLength(0);
    expect(chats[0]?.lastMessageAt).toBeNull();
  });

  test("keeps repeated assistant replies idempotent by turn id", async () => {
    const { chats, messages, dependencies } = createFakeDependencies();
    const chat = await openOrCreateChat(
      {
        userId: "user-1",
        clientChatId: "client-chat-1",
        model: "loyal-oracle",
        firstPrompt: "What happened?",
      },
      dependencies
    );

    expect(chat.created).toBe(true);
    await recordAssistantReply(
      {
        chatId: chat.id,
        content: "Here is what happened.",
        turnId: "turn-1",
      },
      dependencies
    );
    await recordAssistantReply(
      {
        chatId: chat.id,
        content: "Here is what happened.",
        turnId: "turn-1",
      },
      dependencies
    );

    expect(messages).toEqual([
      {
        chatId: chat.id,
        role: "assistant",
        content: "Here is what happened.",
        clientMessageId: null,
        turnId: "turn-1",
      },
    ]);
    expect(chats[0]?.lastMessageAt?.toISOString()).toBe(
      "2026-03-12T00:00:01.000Z"
    );
  });
});
