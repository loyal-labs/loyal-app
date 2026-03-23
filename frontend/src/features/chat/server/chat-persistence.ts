import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import type { UIMessage } from "ai";
import { appChatMessages, appChats } from "@loyal-labs/db-core/schema";

import { getDatabase } from "@/lib/core/database";

const CHAT_TITLE_MAX_LENGTH = 80;

type PersistedChatRecord = {
  id: string;
  title: string | null;
};

export type OpenedOrCreatedChatRecord = PersistedChatRecord & {
  created: boolean;
};

export type OpenOrCreateChatInput = {
  userId: string;
  clientChatId: string | null;
  firstPrompt: string;
  model: string;
};

export type RecordUserMessageInput = {
  chatId: string;
  content: string;
  turnId: string;
  clientMessageId?: string | null;
};

export type RecordAssistantReplyInput = {
  chatId: string;
  content: string;
  turnId: string;
};

type ChatPersistenceDependencies = {
  now: () => Date;
  findChatByClientId: (
    userId: string,
    clientChatId: string
  ) => Promise<PersistedChatRecord | null>;
  createChat: (args: {
    userId: string;
    clientChatId: string | null;
    title: string | null;
    model: string;
    now: Date;
  }) => Promise<PersistedChatRecord | null>;
  setChatTitleIfMissing: (args: {
    chatId: string;
    title: string;
    now: Date;
  }) => Promise<void>;
  insertUserMessage: (args: {
    chatId: string;
    content: string;
    turnId: string;
    clientMessageId: string | null;
    now: Date;
  }) => Promise<boolean>;
  insertAssistantMessage: (args: {
    chatId: string;
    content: string;
    turnId: string;
    now: Date;
  }) => Promise<boolean>;
  touchChatActivity: (chatId: string, now: Date) => Promise<void>;
};

function createChatPersistenceDependencies(): ChatPersistenceDependencies {
  const db = getDatabase();

  return {
    now: () => new Date(),
    findChatByClientId: async (userId, clientChatId) =>
      (await db.query.appChats.findFirst({
        columns: {
          id: true,
          title: true,
        },
        where: and(
          eq(appChats.userId, userId),
          eq(appChats.clientChatId, clientChatId)
        ),
      })) ?? null,
    createChat: async ({ userId, clientChatId, title, model, now }) => {
      const result = await db
        .insert(appChats)
        .values({
          userId,
          clientChatId,
          title,
          model,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({
          id: appChats.id,
          title: appChats.title,
        });

      return result[0] ?? null;
    },
    setChatTitleIfMissing: async ({ chatId, title, now }) => {
      await db
        .update(appChats)
        .set({
          title,
          updatedAt: now,
        })
        .where(and(eq(appChats.id, chatId), isNull(appChats.title)));
    },
    insertUserMessage: async ({
      chatId,
      content,
      turnId,
      clientMessageId,
      now,
    }) => {
      const values = {
        chatId,
        role: "user" as const,
        content,
        clientMessageId,
        turnId,
        createdAt: now,
      };

      const result =
        clientMessageId === null
          ? await db.insert(appChatMessages).values(values).returning({
              id: appChatMessages.id,
            })
          : await db
              .insert(appChatMessages)
              .values(values)
              .onConflictDoNothing({
                target: [
                  appChatMessages.chatId,
                  appChatMessages.clientMessageId,
                ],
                where: sql`${appChatMessages.clientMessageId} IS NOT NULL`,
              })
              .returning({
                id: appChatMessages.id,
              });

      return result.length > 0;
    },
    insertAssistantMessage: async ({ chatId, content, turnId, now }) => {
      const result = await db
        .insert(appChatMessages)
        .values({
          chatId,
          role: "assistant",
          content,
          turnId,
          createdAt: now,
        })
        .onConflictDoNothing({
          target: [appChatMessages.chatId, appChatMessages.role, appChatMessages.turnId],
          where: sql`${appChatMessages.turnId} IS NOT NULL`,
        })
        .returning({
          id: appChatMessages.id,
        });

      return result.length > 0;
    },
    touchChatActivity: async (chatId, now) => {
      await db
        .update(appChats)
        .set({
          updatedAt: now,
          lastMessageAt: now,
        })
        .where(eq(appChats.id, chatId));
    },
  };
}

export function extractMessageText(message: Pick<UIMessage, "parts">): string {
  return message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

export function deriveChatTitle(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= CHAT_TITLE_MAX_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, CHAT_TITLE_MAX_LENGTH - 1).trimEnd()}...`;
}

export async function openOrCreateChat(
  input: OpenOrCreateChatInput,
  dependencies: ChatPersistenceDependencies = createChatPersistenceDependencies()
): Promise<OpenedOrCreatedChatRecord> {
  const now = dependencies.now();
  const title = deriveChatTitle(input.firstPrompt);

  if (input.clientChatId) {
    const existingChat = await dependencies.findChatByClientId(
      input.userId,
      input.clientChatId
    );

    if (existingChat) {
      if (!existingChat.title && title) {
        await dependencies.setChatTitleIfMissing({
          chatId: existingChat.id,
          title,
          now,
        });
        return { ...existingChat, created: false, title };
      }

      return { ...existingChat, created: false };
    }
  }

  const createdChat = await dependencies.createChat({
    userId: input.userId,
    clientChatId: input.clientChatId,
    title,
    model: input.model,
    now,
  });

  if (createdChat) {
    return { ...createdChat, created: true };
  }

  if (!input.clientChatId) {
    throw new Error("Failed to create chat");
  }

  const racedChat = await dependencies.findChatByClientId(
    input.userId,
    input.clientChatId
  );
  if (!racedChat) {
    throw new Error("Failed to provision chat");
  }

  if (!racedChat.title && title) {
    await dependencies.setChatTitleIfMissing({
      chatId: racedChat.id,
      title,
      now,
    });
    return { ...racedChat, created: false, title };
  }

  return { ...racedChat, created: false };
}

export async function recordSubmittedUserMessage(
  input: RecordUserMessageInput,
  dependencies: ChatPersistenceDependencies = createChatPersistenceDependencies()
): Promise<boolean> {
  const content = input.content.trim();
  if (!content) {
    return false;
  }

  const now = dependencies.now();
  const inserted = await dependencies.insertUserMessage({
    chatId: input.chatId,
    content,
    turnId: input.turnId,
    clientMessageId: input.clientMessageId ?? null,
    now,
  });

  if (inserted) {
    await dependencies.touchChatActivity(input.chatId, now);
  }

  return inserted;
}

export async function recordAssistantReply(
  input: RecordAssistantReplyInput,
  dependencies: ChatPersistenceDependencies = createChatPersistenceDependencies()
): Promise<boolean> {
  const content = input.content.trim();
  if (!content) {
    return false;
  }

  const now = dependencies.now();
  const inserted = await dependencies.insertAssistantMessage({
    chatId: input.chatId,
    content,
    turnId: input.turnId,
    now,
  });

  if (inserted) {
    await dependencies.touchChatActivity(input.chatId, now);
  }

  return inserted;
}
