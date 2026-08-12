import {
  pushNotificationSends,
  pushNotificationTickets,
  pushTokens,
} from "@loyal-labs/db-core/schema";
import { and, count, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";
import { getDatabase } from "@/lib/core/database";

import { ManualPushPanel } from "./manual-push-panel";

export const dynamic = "force-dynamic";

type RecentSendRow = {
  id: string;
  source: string;
  audience: string;
  platform: string | null;
  title: string;
  status: string;
  requestedCount: number;
  ticketCount: number;
  receiptOkCount: number;
  receiptErrorCount: number;
  deviceNotRegisteredCount: number;
  sentAt: Date | null;
  receiptsCheckedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
  receiptIdCount: number;
  lastTicketError: string | null;
};

type RecentSendBaseRow = Omit<
  RecentSendRow,
  "receiptIdCount" | "lastTicketError"
>;

type PushNotificationsPageProps = {
  searchParams?: Promise<{
    result?: string | string[];
    message?: string | string[];
  }>;
};

function toSingleValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function getActionMessage(result: string | undefined, message: string | undefined) {
  if (!message) return null;
  if (result === "success") return { kind: "success" as const, message };
  if (result === "error") return { kind: "error" as const, message };
  return null;
}

function getTicketError(row: {
  ticketError: string | null;
  ticketMessage: string | null;
}) {
  if (row.ticketError && row.ticketMessage) {
    return `${row.ticketError}: ${row.ticketMessage}`;
  }
  return row.ticketError ?? row.ticketMessage;
}

async function getPushTokenCount(platform?: "ios" | "android") {
  const db = getDatabase();
  const [row] = await db
    .select({ count: count() })
    .from(pushTokens)
    .where(
      platform
        ? and(
            isNotNull(pushTokens.walletPublicKey),
            eq(pushTokens.platform, platform)
          )
        : isNotNull(pushTokens.walletPublicKey)
    );

  return row?.count ?? 0;
}

export default async function PushNotificationsPage({
  searchParams,
}: PushNotificationsPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const result = toSingleValue(resolvedSearchParams.result);
  const message = toSingleValue(resolvedSearchParams.message);
  const actionMessage = getActionMessage(result, message);
  const db = getDatabase();
  const [all, ios, android, recentSendRows] = await Promise.all([
    getPushTokenCount(),
    getPushTokenCount("ios"),
    getPushTokenCount("android"),
    db
      .select({
        id: pushNotificationSends.id,
        source: pushNotificationSends.source,
        audience: pushNotificationSends.audience,
        platform: pushNotificationSends.platform,
        title: pushNotificationSends.title,
        status: pushNotificationSends.status,
        requestedCount: pushNotificationSends.requestedCount,
        ticketCount: pushNotificationSends.ticketCount,
        receiptOkCount: pushNotificationSends.receiptOkCount,
        receiptErrorCount: pushNotificationSends.receiptErrorCount,
        deviceNotRegisteredCount:
          pushNotificationSends.deviceNotRegisteredCount,
        sentAt: pushNotificationSends.sentAt,
        receiptsCheckedAt: pushNotificationSends.receiptsCheckedAt,
        createdAt: pushNotificationSends.createdAt,
        createdBy: pushNotificationSends.createdBy,
      })
      .from(pushNotificationSends)
      .where(eq(pushNotificationSends.source, "admin"))
      .orderBy(desc(pushNotificationSends.createdAt))
      .limit(20) as Promise<RecentSendBaseRow[]>,
  ]);
  const ticketRows =
    recentSendRows.length > 0
      ? await db
          .select({
            sendId: pushNotificationTickets.sendId,
            ticketId: pushNotificationTickets.ticketId,
            ticketStatus: pushNotificationTickets.ticketStatus,
            ticketMessage: pushNotificationTickets.ticketMessage,
            ticketError: pushNotificationTickets.ticketError,
          })
          .from(pushNotificationTickets)
          .where(
            inArray(
              pushNotificationTickets.sendId,
              recentSendRows.map((send) => send.id)
            )
          )
      : [];
  const ticketMetaBySendId = new Map<
    string,
    { receiptIdCount: number; lastTicketError: string | null }
  >();

  for (const row of ticketRows) {
    const meta = ticketMetaBySendId.get(row.sendId) ?? {
      receiptIdCount: 0,
      lastTicketError: null,
    };
    if (row.ticketId) {
      meta.receiptIdCount += 1;
    }
    if (row.ticketStatus === "error") {
      meta.lastTicketError = getTicketError(row);
    }
    ticketMetaBySendId.set(row.sendId, meta);
  }
  const recentSends = recentSendRows.map((send) => ({
    ...send,
    receiptIdCount: ticketMetaBySendId.get(send.id)?.receiptIdCount ?? 0,
    lastTicketError: ticketMetaBySendId.get(send.id)?.lastTicketError ?? null,
  }));

  return (
    <PageContainer>
      <SectionHeader
        title="Push notifications"
        breadcrumbs={[{ label: "Push notifications" }]}
        subtitle="Manual mobile broadcasts and Expo delivery cleanup."
      />
      <ManualPushPanel
        counts={{ all, ios, android }}
        actionMessage={actionMessage}
        recentSends={recentSends.map((send) => ({
          ...send,
          sentAt: send.sentAt?.toISOString() ?? null,
          receiptsCheckedAt: send.receiptsCheckedAt?.toISOString() ?? null,
          createdAt: send.createdAt.toISOString(),
        }))}
      />
    </PageContainer>
  );
}
