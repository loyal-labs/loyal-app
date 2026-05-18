"use server";

import {
  pushNotificationSends,
  pushNotificationTickets,
  pushTokens,
  type ManualPushAudience,
} from "@loyal-labs/db-core/schema";
import {
  getExpoPushReceipts,
  sendExpoPushMessages,
} from "@loyal-labs/shared/expo-push";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getDatabase } from "@/lib/core/database";

type ActionResult = { success: true; message: string } | { error: string };

type TokenRow = { token: string };

type ReceiptTicketRow = {
  id: string;
  token: string;
  ticketId: string | null;
};

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function parsePlatform(
  value: FormDataEntryValue | null
): "all" | "ios" | "android" | "wallet" {
  return value === "ios" || value === "android" || value === "wallet"
    ? value
    : "all";
}

function parseJsonData(
  value: FormDataEntryValue | null
): Record<string, unknown> | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Data must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

function redirectWithActionResult(result: ActionResult): never {
  const searchParams = new URLSearchParams();
  if ("error" in result) {
    searchParams.set("result", "error");
    searchParams.set("message", result.error);
  } else {
    searchParams.set("result", "success");
    searchParams.set("message", result.message);
  }
  redirect(`/push-notifications?${searchParams.toString()}`);
}

export async function sendManualPushNotification(
  formData: FormData
): Promise<ActionResult> {
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const createdBy = String(formData.get("createdBy") ?? "").trim() || null;
  const confirmation = String(formData.get("confirmation") ?? "").trim();
  const platform = parsePlatform(formData.get("platform"));
  const walletPublicKey = String(formData.get("walletPublicKey") ?? "").trim();

  if (!title || !body) {
    return { error: "Title and body are required" };
  }

  if (confirmation !== "SEND") {
    return { error: "Type SEND to confirm the broadcast" };
  }

  if (platform === "wallet" && !walletPublicKey) {
    return { error: "Wallet public key is required for wallet test sends" };
  }

  let data: Record<string, unknown> | null = null;
  try {
    data = parseJsonData(formData.get("data"));
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid JSON data",
    };
  }

  const db = getDatabase();
  const tokenRows = (await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(
      platform === "wallet"
        ? eq(pushTokens.walletPublicKey, walletPublicKey)
        : platform === "all"
        ? isNotNull(pushTokens.walletPublicKey)
        : and(
            isNotNull(pushTokens.walletPublicKey),
            eq(pushTokens.platform, platform)
          )
    )) as TokenRow[];

  const tokens = Array.from(new Set(tokenRows.map((row) => row.token)));
  const audience: ManualPushAudience =
    platform === "wallet" ? "wallet" : platform === "all" ? "all" : "platform";
  const [sendRow] = await db
    .insert(pushNotificationSends)
    .values({
      source: "admin",
      audience,
      platform: platform === "ios" || platform === "android" ? platform : null,
      title,
      body,
      data,
      createdBy,
      status: "sending",
      requestedCount: tokens.length,
    })
    .returning({ id: pushNotificationSends.id });

  if (!sendRow) {
    return { error: "Failed to create push send record" };
  }

  if (tokens.length === 0) {
    await db
      .update(pushNotificationSends)
      .set({
        status: "sent",
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(pushNotificationSends.id, sendRow.id));
    revalidatePath("/push-notifications");
    return {
      success: true,
      message: "No registered mobile push tokens matched",
    };
  }

  try {
    const result = await sendExpoPushMessages(
      tokens.map((token) => ({
        to: token,
        title,
        body,
        data: data ?? undefined,
        sound: "default",
      }))
    );
    const receiptIdCount = result.receiptIds.length;
    const ticketErrors = result.tickets.filter(
      ({ ticket }) => ticket.status === "error"
    );
    const firstTicketError = ticketErrors[0]?.ticket.details?.error
      ? `${ticketErrors[0].ticket.details.error}: ${
          ticketErrors[0].ticket.message ?? "Expo rejected the ticket"
        }`
      : ticketErrors[0]?.ticket.message ?? null;

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
        status: receiptIdCount === 0 ? "failed" : "sent",
        ticketCount: result.tickets.length,
        deviceNotRegisteredCount: staleTokens.length,
        errorMessage: receiptIdCount === 0 ? firstTicketError : null,
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(pushNotificationSends.id, sendRow.id));

    revalidatePath("/push-notifications");
    if (receiptIdCount === 0) {
      return {
        error: `Expo rejected all push tickets: ${
          firstTicketError ?? "no receipt IDs were returned"
        }`,
      };
    }

    return {
      success: true,
      message: `Accepted ${receiptIdCount}/${tokens.length} push tickets. Pruned ${staleTokens.length} dead tokens.`,
    };
  } catch (error) {
    await db
      .update(pushNotificationSends)
      .set({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(pushNotificationSends.id, sendRow.id));
    revalidatePath("/push-notifications");
    return { error: "Expo push send failed" };
  }
}

export async function checkPushReceipts(sendId: string): Promise<ActionResult> {
  const db = getDatabase();
  const ticketRows = (await db
    .select({
      id: pushNotificationTickets.id,
      token: pushNotificationTickets.token,
      ticketId: pushNotificationTickets.ticketId,
    })
    .from(pushNotificationTickets)
    .where(
      and(
        eq(pushNotificationTickets.sendId, sendId),
        isNotNull(pushNotificationTickets.ticketId)
      )
    )) as ReceiptTicketRow[];

  const ticketRowsWithReceiptIds = ticketRows.flatMap((row) =>
    typeof row.ticketId === "string" && row.ticketId.length > 0
      ? [{ ...row, ticketId: row.ticketId }]
      : []
  );

  if (ticketRowsWithReceiptIds.length === 0) {
    return { error: "No receipt IDs are available for this send" };
  }

  try {
    const receiptResult = await getExpoPushReceipts(
      ticketRowsWithReceiptIds.map((row) => row.ticketId)
    );
    const staleReceiptIds = new Set(
      receiptResult.deviceNotRegisteredReceiptIds
    );
    const staleTokens = new Set<string>();
    let receiptOkCount = 0;
    let receiptErrorCount = 0;

    for (const row of ticketRowsWithReceiptIds) {
      const receipt = receiptResult.receipts[row.ticketId];
      if (!receipt) continue;

      if (receipt.status === "ok") {
        receiptOkCount += 1;
      } else {
        receiptErrorCount += 1;
      }

      if (staleReceiptIds.has(row.ticketId)) {
        staleTokens.add(row.token);
      }

      await db
        .update(pushNotificationTickets)
        .set({
          receiptStatus: receipt.status,
          receiptMessage: receipt.message ?? null,
          receiptError: receipt.details?.error ?? null,
          updatedAt: new Date(),
        })
        .where(eq(pushNotificationTickets.id, row.id));
    }

    const staleTokenList = Array.from(staleTokens);
    for (const staleTokenChunk of chunk(staleTokenList, 1000)) {
      await db
        .delete(pushTokens)
        .where(inArray(pushTokens.token, staleTokenChunk));
    }

    const [sendRow] = await db
      .select({
        deviceNotRegisteredCount:
          pushNotificationSends.deviceNotRegisteredCount,
      })
      .from(pushNotificationSends)
      .where(eq(pushNotificationSends.id, sendId));

    await db
      .update(pushNotificationSends)
      .set({
        status: "receipt_checked",
        receiptOkCount,
        receiptErrorCount,
        deviceNotRegisteredCount:
          (sendRow?.deviceNotRegisteredCount ?? 0) + staleTokenList.length,
        receiptsCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(pushNotificationSends.id, sendId));

    revalidatePath("/push-notifications");
    return {
      success: true,
      message: `Checked ${
        receiptOkCount + receiptErrorCount
      } receipts. Pruned ${staleTokenList.length} dead tokens.`,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Failed to check receipts",
    };
  }
}

export async function submitManualPushNotification(formData: FormData) {
  redirectWithActionResult(await sendManualPushNotification(formData));
}

export async function submitPushReceiptCheck(formData: FormData) {
  const sendId = String(formData.get("sendId") ?? "");
  redirectWithActionResult(await checkPushReceipts(sendId));
}
