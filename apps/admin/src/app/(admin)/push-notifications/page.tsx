import {
  pushNotificationSends,
  pushNotificationTickets,
  pushTokens,
} from "@loyal-labs/db-core/schema";
import { desc, eq, inArray, sql } from "drizzle-orm";

import { PageContainer } from "@/components/layout/page-container";
import { SectionHeader } from "@/components/layout/section-header";
import { getDatabase } from "@/lib/core/database";
import { requireAdminSession } from "@/lib/require-admin-session";

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

function getActionMessage(
  result: string | undefined,
  message: string | undefined
) {
  if (!message) return null;
  if (result === "success") return { kind: "success" as const, message };
  if (result === "error") return { kind: "error" as const, message };
  return null;
}

export default async function PushNotificationsPage({
  searchParams,
}: PushNotificationsPageProps) {
  await requireAdminSession();

  const resolvedSearchParams = (await searchParams) ?? {};
  const result = toSingleValue(resolvedSearchParams.result);
  const message = toSingleValue(resolvedSearchParams.message);
  const actionMessage = getActionMessage(result, message);
  const db = getDatabase();
  const [[tokenCounts], recentSendRows] = await Promise.all([
    db
      .select({
        all: sql<number>`count(*) FILTER (
          WHERE ${pushTokens.walletPublicKey} IS NOT NULL
        )`,
        android: sql<number>`count(*) FILTER (
          WHERE ${pushTokens.walletPublicKey} IS NOT NULL
            AND ${pushTokens.platform} = 'android'
        )`,
        ios: sql<number>`count(*) FILTER (
          WHERE ${pushTokens.walletPublicKey} IS NOT NULL
            AND ${pushTokens.platform} = 'ios'
        )`,
      })
      .from(pushTokens),
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
  const ticketMetaRows =
    recentSendRows.length > 0
      ? await db
          .select({
            sendId: pushNotificationTickets.sendId,
            receiptIdCount: sql<number>`count(*) FILTER (
              WHERE ${pushNotificationTickets.ticketId} IS NOT NULL
            )`,
            lastTicketError: sql<string | null>`(
              ARRAY_AGG(
                NULLIF(
                  CONCAT_WS(
                    ': ',
                    ${pushNotificationTickets.ticketError},
                    ${pushNotificationTickets.ticketMessage}
                  ),
                  ''
                )
                ORDER BY ${pushNotificationTickets.updatedAt} DESC
              ) FILTER (WHERE ${pushNotificationTickets.ticketStatus} = 'error')
            )[1]`,
          })
          .from(pushNotificationTickets)
          .where(
            inArray(
              pushNotificationTickets.sendId,
              recentSendRows.map((send) => send.id)
            )
          )
          .groupBy(pushNotificationTickets.sendId)
      : [];
  const ticketMetaBySendId = new Map(
    ticketMetaRows.map((row) => [row.sendId, row])
  );
  const recentSends = recentSendRows.map((send) => ({
    ...send,
    receiptIdCount: Number(
      ticketMetaBySendId.get(send.id)?.receiptIdCount ?? 0
    ),
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
        counts={{
          all: Number(tokenCounts?.all ?? 0),
          android: Number(tokenCounts?.android ?? 0),
          ios: Number(tokenCounts?.ios ?? 0),
        }}
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
