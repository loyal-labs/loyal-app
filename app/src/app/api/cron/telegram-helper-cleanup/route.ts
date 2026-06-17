import { telegramHelperMessageCleanup } from "@loyal-labs/db-core/schema";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/core/database";
import { getBot } from "@/lib/telegram/bot-api/bot";

import { validateCronAuthHeader } from "../_shared/auth";

export const runtime = "nodejs";

const CLEANUP_BATCH_LIMIT = 200;
const CLAIM_LEASE_MS = 120_000;
const RETRY_DELAY_MS = 60_000;
const MAX_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

type CleanupQueueItem = {
  createdAt: Date;
  deleteAfter: Date;
  chatId: bigint;
  id: string;
  messageId: number;
};

export type TelegramHelperCleanupStats = {
  claimed: number;
  droppedExpired: number;
  due: number;
  queueDeleted: number;
  retryScheduled: number;
  skippedAlreadyClaimed: number;
  successfulDeletes: number;
  terminalErrors: number;
  transientErrors: number;
};

export async function GET(request: Request): Promise<NextResponse> {
  return POST(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  const authErrorResponse = validateCronAuthHeader(request);
  if (authErrorResponse) {
    return authErrorResponse;
  }

  const now = new Date();
  const db = getDatabase();
  const dueMessages = await db.query.telegramHelperMessageCleanup.findMany({
    columns: {
      createdAt: true,
      deleteAfter: true,
      chatId: true,
      id: true,
      messageId: true,
    },
    limit: CLEANUP_BATCH_LIMIT,
    orderBy: asc(telegramHelperMessageCleanup.deleteAfter),
    where: lte(telegramHelperMessageCleanup.deleteAfter, now),
  });

  const stats: TelegramHelperCleanupStats = {
    claimed: 0,
    droppedExpired: 0,
    due: dueMessages.length,
    queueDeleted: 0,
    retryScheduled: 0,
    skippedAlreadyClaimed: 0,
    successfulDeletes: 0,
    terminalErrors: 0,
    transientErrors: 0,
  };

  if (dueMessages.length === 0) {
    return NextResponse.json({ ok: true, stats });
  }

  const bot = await getBot();
  const queueIdsToDelete: string[] = [];
  const claimLeaseUntil = new Date(now.getTime() + CLAIM_LEASE_MS);
  const retryAfter = new Date(now.getTime() + RETRY_DELAY_MS);

  for (const item of dueMessages) {
    const claimed = await claimDueCleanupItem(item.id, now, claimLeaseUntil);
    if (!claimed) {
      stats.skippedAlreadyClaimed += 1;
      continue;
    }
    stats.claimed += 1;

    const deleteOutcome = await deleteTelegramHelperMessage(bot, item, stats);

    if (deleteOutcome === "success" || deleteOutcome === "terminal") {
      queueIdsToDelete.push(item.id);
      continue;
    }

    const itemAgeMs = now.getTime() - item.createdAt.getTime();
    if (itemAgeMs > MAX_RETRY_WINDOW_MS) {
      stats.droppedExpired += 1;
      queueIdsToDelete.push(item.id);
      continue;
    }

    await rescheduleCleanupItem(item.id, retryAfter);
    stats.retryScheduled += 1;
  }

  if (queueIdsToDelete.length > 0) {
    await db
      .delete(telegramHelperMessageCleanup)
      .where(inArray(telegramHelperMessageCleanup.id, queueIdsToDelete));
  }
  stats.queueDeleted = queueIdsToDelete.length;

  return NextResponse.json({ ok: true, stats });
}

async function deleteTelegramHelperMessage(
  bot: Awaited<ReturnType<typeof getBot>>,
  item: CleanupQueueItem,
  stats: TelegramHelperCleanupStats
): Promise<"success" | "terminal" | "transient"> {
  try {
    await bot.api.deleteMessage(String(item.chatId), item.messageId);
    stats.successfulDeletes += 1;
    return "success";
  } catch (error) {
    const parsedError = parseTelegramError(error);
    const errorMessage =
      parsedError.description ??
      (error instanceof Error ? error.message : String(error));

    if (isTransientTelegramDeleteError(error)) {
      stats.transientErrors += 1;
      console.warn("[cron/telegram-helper-cleanup] Transient delete failure", {
        chatId: String(item.chatId),
        error: errorMessage,
        errorCode: parsedError.errorCode,
        messageId: item.messageId,
        queueId: item.id,
      });
      return "transient";
    }

    stats.terminalErrors += 1;
    console.warn("[cron/telegram-helper-cleanup] Terminal delete failure", {
      chatId: String(item.chatId),
      error: errorMessage,
      errorCode: parsedError.errorCode,
      messageId: item.messageId,
      queueId: item.id,
    });
    return "terminal";
  }
}

async function claimDueCleanupItem(
  itemId: string,
  now: Date,
  claimLeaseUntil: Date
): Promise<boolean> {
  const db = getDatabase();
  const claimed = await db
    .update(telegramHelperMessageCleanup)
    .set({ deleteAfter: claimLeaseUntil })
    .where(
      and(
        eq(telegramHelperMessageCleanup.id, itemId),
        lte(telegramHelperMessageCleanup.deleteAfter, now)
      )
    )
    .returning({ id: telegramHelperMessageCleanup.id });

  return claimed.length > 0;
}

async function rescheduleCleanupItem(
  itemId: string,
  retryAfter: Date
): Promise<void> {
  const db = getDatabase();
  await db
    .update(telegramHelperMessageCleanup)
    .set({ deleteAfter: retryAfter })
    .where(eq(telegramHelperMessageCleanup.id, itemId));
}

function isTransientTelegramDeleteError(error: unknown): boolean {
  const parsedError = parseTelegramError(error);
  if (!parsedError.errorCode) {
    return true;
  }

  if (parsedError.errorCode === 429) {
    return true;
  }

  if (parsedError.errorCode >= 500) {
    return true;
  }

  if (parsedError.errorCode === 400 || parsedError.errorCode === 403) {
    return false;
  }

  if (
    parsedError.description &&
    /message to delete not found|message can't be deleted|chat not found|bot was kicked|forbidden/i.test(
      parsedError.description
    )
  ) {
    return false;
  }

  return true;
}

function parseTelegramError(error: unknown): {
  description?: string;
  errorCode?: number;
} {
  if (!error || typeof error !== "object") {
    return {};
  }

  const maybeError = error as {
    description?: unknown;
    error_code?: unknown;
    response?: {
      description?: unknown;
      error_code?: unknown;
    };
  };

  const errorCode =
    typeof maybeError.error_code === "number"
      ? maybeError.error_code
      : typeof maybeError.response?.error_code === "number"
      ? maybeError.response.error_code
      : undefined;

  const description =
    typeof maybeError.description === "string"
      ? maybeError.description
      : typeof maybeError.response?.description === "string"
      ? maybeError.response.description
      : undefined;

  return { description, errorCode };
}
