export type TelegramHistoryClient = {
  getMessages: (
    chatId: number,
    messageIds: number[]
  ) => Promise<Array<unknown | null>>;
  getHistory: (
    chatId: number,
    params?: { limit?: number }
  ) => Promise<unknown[]>;
  iterHistory: (
    chatId: number,
    params?: { chunkSize?: number; minId?: number }
  ) => AsyncIterable<unknown>;
};

export type IngestibleMessage = {
  content: string;
  createdAt: Date;
  messageId: number;
  senderDisplayName: string;
  senderTelegramId: bigint;
  senderUsername: string | null;
};

export type MessageFilterStats = {
  skippedNonText: number;
  skippedNonUserSender: number;
  skippedUnsupportedShape: number;
};

export type PersistenceStats = {
  duplicateMessages: number;
  insertedMemberships: number;
  insertedMessages: number;
  insertedUsers: number;
  userMetadataUpdates: number;
};
