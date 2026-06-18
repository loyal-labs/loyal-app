import type { TelegramHistoryClient } from "./types";

const INITIAL_BACKFILL_LIMIT = 200;
const HISTORY_CHUNK_SIZE = 200;
export const BOT_ID_BATCH_SIZE = 200;
export const BOT_EMPTY_BATCH_STOP_COUNT = 1;

function readMessageId(message: unknown): number | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const id = (message as { id?: unknown }).id;
  if (!Number.isInteger(id) || (id as number) <= 0) {
    return null;
  }

  return id as number;
}

function readMessageDate(message: unknown): Date | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const value = (message as { date?: unknown }).date;
  return value instanceof Date && Number.isFinite(value.getTime())
    ? value
    : null;
}

export async function getLatestTelegramMessageId(
  client: TelegramHistoryClient,
  chatId: number
): Promise<number | null> {
  const latestHistory = await client.getHistory(chatId, { limit: 1 });
  return readMessageId(latestHistory[0] ?? null);
}

export async function* fetchUnseenMessages(
  client: TelegramHistoryClient,
  chatId: number,
  lastStoredMessageId: number | null
): AsyncGenerator<unknown> {
  if (lastStoredMessageId === null) {
    const initialBatch = await client.getHistory(chatId, {
      limit: INITIAL_BACKFILL_LIMIT,
    });

    // Keep first-sync deterministic in ascending message-id order.
    const orderedInitialBatch = [...initialBatch].sort((left, right) => {
      const leftId = readMessageId(left);
      const rightId = readMessageId(right);
      if (leftId === null || rightId === null) {
        return 0;
      }

      return leftId - rightId;
    });

    for (const message of orderedInitialBatch) {
      yield message;
    }
    return;
  }

  for await (const message of client.iterHistory(chatId, {
    chunkSize: HISTORY_CHUNK_SIZE,
    minId: lastStoredMessageId,
  })) {
    yield message;
  }
}

export async function* fetchMessagesSince(
  client: TelegramHistoryClient,
  chatId: number,
  startUtcInclusive: Date
): AsyncGenerator<unknown> {
  const cutoffTime = startUtcInclusive.getTime();

  for await (const message of client.iterHistory(chatId, {
    chunkSize: HISTORY_CHUNK_SIZE,
  })) {
    const messageDate = readMessageDate(message);
    if (messageDate && messageDate.getTime() < cutoffTime) {
      break;
    }

    yield message;
  }
}

type BotBatchObserverPayload = {
  fromMessageId: number;
  requestedMessageIds: number;
  returnedMessages: number;
  wasEmpty: boolean;
};

type BotBatchFetchOptions = {
  batchSize?: number;
  onBatch?: (payload: BotBatchObserverPayload) => void;
  sleep?: (ms: number) => Promise<void>;
  stopAfterEmptyBatches?: number;
};

function buildMessageIdBatch(startId: number, batchSize: number): number[] {
  return Array.from({ length: batchSize }, (_, index) => startId + index);
}

function resolveIdBatchMessageOrder(
  messages: Array<unknown | null>
): Array<unknown> {
  return messages
    .filter((message): message is unknown => message !== null)
    .sort((left, right) => {
      const leftId = readMessageId(left);
      const rightId = readMessageId(right);
      if (leftId === null || rightId === null) {
        return 0;
      }

      return leftId - rightId;
    });
}

function parseFloodWaitSeconds(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /wait of\s+(\d+)\s+seconds/i.exec(message);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function* fetchUnseenMessagesByIdBatches(
  client: TelegramHistoryClient,
  chatId: number,
  lastStoredMessageId: number | null,
  options: BotBatchFetchOptions = {}
): AsyncGenerator<unknown> {
  const batchSize = options.batchSize ?? BOT_ID_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("batchSize must be a positive integer");
  }

  const stopAfterEmptyBatches =
    options.stopAfterEmptyBatches ?? BOT_EMPTY_BATCH_STOP_COUNT;
  if (!Number.isInteger(stopAfterEmptyBatches) || stopAfterEmptyBatches <= 0) {
    throw new Error("stopAfterEmptyBatches must be a positive integer");
  }

  const sleep =
    options.sleep ??
    (async (ms: number): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });

  let consecutiveEmptyBatches = 0;
  let nextMessageId =
    lastStoredMessageId === null ? 1 : lastStoredMessageId + 1;

  while (consecutiveEmptyBatches < stopAfterEmptyBatches) {
    const requestedIds = buildMessageIdBatch(nextMessageId, batchSize);
    let fetchedMessages: Array<unknown | null>;
    while (true) {
      try {
        fetchedMessages = await client.getMessages(chatId, requestedIds);
        break;
      } catch (error) {
        const waitSeconds = parseFloodWaitSeconds(error);
        if (waitSeconds === null) {
          throw error;
        }

        await sleep((waitSeconds + 1) * 1_000);
      }
    }

    const orderedMessages = resolveIdBatchMessageOrder(fetchedMessages);
    const wasEmpty = orderedMessages.length === 0;

    options.onBatch?.({
      fromMessageId: nextMessageId,
      requestedMessageIds: requestedIds.length,
      returnedMessages: orderedMessages.length,
      wasEmpty,
    });

    if (wasEmpty) {
      consecutiveEmptyBatches += 1;
      nextMessageId += batchSize;
      continue;
    }

    consecutiveEmptyBatches = 0;
    for (const message of orderedMessages) {
      yield message;
    }

    nextMessageId += batchSize;
  }
}
