import {
  pushNotificationSends,
  pushNotificationTickets,
  pushTokens,
} from "@loyal-labs/db-core/schema";
import {
  type ExpoPushMessage,
  sendExpoPushMessages,
} from "@loyal-labs/shared/expo-push";
import { eq, inArray } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";

export type { ExpoPushMessage };

export type ExpoPushDispatchResult = {
  sendId: string | null;
  requested: number;
  ticketCount: number;
  prunedTokenCount: number;
};

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Send push notifications via Expo Push API.
 * Docs: https://docs.expo.dev/push-notifications/sending-notifications/
 */
export async function sendExpoPushNotifications(
  messages: ExpoPushMessage[],
  options: { source?: string } = {}
): Promise<ExpoPushDispatchResult> {
  if (messages.length === 0) {
    return {
      sendId: null,
      requested: 0,
      ticketCount: 0,
      prunedTokenCount: 0,
    };
  }

  const db = getDatabase();
  const [sendRow] = await db
    .insert(pushNotificationSends)
    .values({
      source: options.source ?? "system",
      audience: "all",
      title: messages[0]?.title ?? "Notification",
      body: messages[0]?.body ?? "",
      data: null,
      status: "sending",
      requestedCount: messages.length,
    })
    .returning({ id: pushNotificationSends.id });

  if (!sendRow) {
    throw new Error("Failed to create push notification send record");
  }

  try {
    const result = await sendExpoPushMessages(messages);
    const now = new Date();

    for (const ticketChunk of chunk(result.tickets, 1000)) {
      await db.insert(pushNotificationTickets).values(
        ticketChunk.map(({ token, ticket }) => ({
          sendId: sendRow.id,
          token,
          ticketId: ticket.id ?? null,
          ticketStatus: ticket.status,
          ticketMessage: ticket.message ?? null,
          ticketError: ticket.details?.error ?? null,
        }))
      );
    }

    const staleTokens = Array.from(new Set(result.deviceNotRegisteredTokens));
    for (const staleTokenChunk of chunk(staleTokens, 1000)) {
      await db
        .delete(pushTokens)
        .where(inArray(pushTokens.token, staleTokenChunk));
    }

    await db
      .update(pushNotificationSends)
      .set({
        status: "sent",
        ticketCount: result.tickets.length,
        deviceNotRegisteredCount: staleTokens.length,
        sentAt: now,
        updatedAt: now,
      })
      .where(eq(pushNotificationSends.id, sendRow.id));

    return {
      sendId: sendRow.id,
      requested: result.requested,
      ticketCount: result.tickets.length,
      prunedTokenCount: staleTokens.length,
    };
  } catch (error) {
    const now = new Date();
    console.error("[push] Failed to send push notifications:", error);
    await db
      .update(pushNotificationSends)
      .set({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        updatedAt: now,
      })
      .where(eq(pushNotificationSends.id, sendRow.id));
    return {
      sendId: sendRow.id,
      requested: messages.length,
      ticketCount: 0,
      prunedTokenCount: 0,
    };
  }
}
