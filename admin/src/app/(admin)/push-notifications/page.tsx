import { pushNotificationSends, pushTokens } from "@loyal-labs/db-core/schema";
import { and, count, desc, eq, isNotNull } from "drizzle-orm";

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
};

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

export default async function PushNotificationsPage() {
  const db = getDatabase();
  const [all, ios, android, recentSends] = await Promise.all([
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
      .orderBy(desc(pushNotificationSends.createdAt))
      .limit(20) as Promise<RecentSendRow[]>,
  ]);

  return (
    <PageContainer>
      <SectionHeader
        title="Push notifications"
        breadcrumbs={[{ label: "Push notifications" }]}
        subtitle="Manual mobile broadcasts and Expo delivery cleanup."
      />
      <ManualPushPanel
        counts={{ all, ios, android }}
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
