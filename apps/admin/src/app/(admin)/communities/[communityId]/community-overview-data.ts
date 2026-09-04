import "server-only";

import { unstable_cache } from "next/cache";
import { and, asc, count, desc, eq, gte, lt, sql } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";
import { DATA_CACHE_TTL_SECONDS, communityTag } from "@/lib/data-cache";
import {
  communities,
  messages,
  summaries,
  users,
} from "@loyal-labs/db-core/schema";

export type CommunityOverviewChartPoint = {
  date: string;
  summaries: number;
};

export type CommunityMessagesChartPoint = {
  date: string;
  messages: number;
};

export type CommunityActiveUsersChartPoint = {
  date: string;
  activeUsers: number;
};

export type CommunityTopUserChartPoint = {
  userLabel: string;
  messageCount: number;
};

export type CommunityOverviewTotals = {
  summaries: number;
  messages: number;
};

export type CommunityMessagesStats = {
  averagePerDay: number;
  medianPerDay: number;
};

export type CommunityActiveUsersStats = {
  averagePerDay: number;
  medianPerDay: number;
};

export type CommunityOverviewData = {
  community: {
    id: string;
    chatTitle: string;
    chatId: string;
    isActive: boolean;
    isPublic: boolean;
    summaryNotificationsEnabled: boolean;
    summaryNotificationTimeHours: 24 | 48 | null;
    summaryNotificationMessageCount: 500 | 1000 | null;
  };
  chartPoints: CommunityOverviewChartPoint[];
  messagesChartPoints: CommunityMessagesChartPoint[];
  activeUsersChartPoints: CommunityActiveUsersChartPoint[];
  topUsersChartPoints: CommunityTopUserChartPoint[];
  totals30d: CommunityOverviewTotals;
  messagesStats30d: CommunityMessagesStats;
  activeUsersStats30d: CommunityActiveUsersStats;
};

export function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function getWindowBoundsUtc() {
  const now = new Date();
  const endExclusive = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  const startInclusive = new Date(endExclusive);
  startInclusive.setUTCDate(startInclusive.getUTCDate() - 30);

  return { startInclusive, endExclusive };
}

function getDayKeys(startInclusive: Date, numberOfDays: number) {
  const dayKeys: string[] = [];

  for (let i = 0; i < numberOfDays; i += 1) {
    const day = new Date(startInclusive);
    day.setUTCDate(startInclusive.getUTCDate() + i);
    dayKeys.push(day.toISOString().slice(0, 10));
  }

  return dayKeys;
}

async function loadCommunityOverviewData(
  communityId: string
): Promise<CommunityOverviewData | null> {
  const db = getDatabase();
  const [community] = await db
    .select({
      id: communities.id,
      chatTitle: communities.chatTitle,
      chatId: communities.chatId,
      isActive: communities.isActive,
      isPublic: communities.isPublic,
      summaryNotificationsEnabled: communities.summaryNotificationsEnabled,
      summaryNotificationTimeHours: communities.summaryNotificationTimeHours,
      summaryNotificationMessageCount:
        communities.summaryNotificationMessageCount,
    })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);

  if (!community) {
    return null;
  }

  const { startInclusive, endExclusive } = getWindowBoundsUtc();
  const dayKeys = getDayKeys(startInclusive, 30);

  const summariesDayExpression = sql<string>`
    to_char((date_trunc('day', ${summaries.createdAt} AT TIME ZONE 'UTC'))::date, 'YYYY-MM-DD')
  `;
  const messagesDayExpression = sql<string>`
    to_char((date_trunc('day', ${messages.createdAt} AT TIME ZONE 'UTC'))::date, 'YYYY-MM-DD')
  `;

  const totalMessagesByUserExpression = count(messages.id);

  const [summaryRows, messageRows, activeUserRows, topUserRows] =
    await Promise.all([
      db
        .select({
          day: summariesDayExpression,
          count: count(),
        })
        .from(summaries)
        .where(
          and(
            eq(summaries.communityId, communityId),
            gte(summaries.createdAt, startInclusive),
            lt(summaries.createdAt, endExclusive)
          )
        )
        .groupBy(summariesDayExpression),
      db
        .select({
          day: messagesDayExpression,
          count: count(),
        })
        .from(messages)
        .where(
          and(
            eq(messages.communityId, communityId),
            gte(messages.createdAt, startInclusive),
            lt(messages.createdAt, endExclusive)
          )
        )
        .groupBy(messagesDayExpression),
      db
        .select({
          day: messagesDayExpression,
          count: sql<number>`count(distinct ${messages.userId})`,
        })
        .from(messages)
        .where(
          and(
            eq(messages.communityId, communityId),
            gte(messages.createdAt, startInclusive),
            lt(messages.createdAt, endExclusive)
          )
        )
        .groupBy(messagesDayExpression),
      db
        .select({
          userId: messages.userId,
          displayName: users.displayName,
          username: users.username,
          messageCount: totalMessagesByUserExpression,
        })
        .from(messages)
        .leftJoin(users, eq(messages.userId, users.id))
        .where(
          and(
            eq(messages.communityId, communityId),
            gte(messages.createdAt, startInclusive),
            lt(messages.createdAt, endExclusive)
          )
        )
        .groupBy(messages.userId, users.displayName, users.username)
        .orderBy(desc(totalMessagesByUserExpression), asc(messages.userId))
        .limit(20),
    ]);

  const summariesByDay = new Map(
    summaryRows.map((row) => [row.day, Number(row.count) || 0])
  );
  const messagesByDay = new Map(
    messageRows.map((row) => [row.day, Number(row.count) || 0])
  );
  const activeUsersByDay = new Map(
    activeUserRows.map((row) => [row.day, Number(row.count) || 0])
  );
  const topUsersChartPoints: CommunityTopUserChartPoint[] = topUserRows.map(
    (row) => {
      const displayName = row.displayName?.trim();
      const normalizedUsername = row.username?.trim().replace(/^@+/, "");

      const userLabel =
        displayName && displayName.length > 0
          ? displayName
          : normalizedUsername && normalizedUsername.length > 0
          ? `@${normalizedUsername}`
          : row.userId.slice(0, 8);

      return {
        userLabel,
        messageCount: Number(row.messageCount) || 0,
      };
    }
  );

  let runningSummariesTotal = 0;
  let messagesTotal30d = 0;

  const chartPoints: CommunityOverviewChartPoint[] = [];
  const messagesChartPoints: CommunityMessagesChartPoint[] = [];
  const activeUsersChartPoints: CommunityActiveUsersChartPoint[] = [];
  const dailyMessageCounts: number[] = [];
  const dailyActiveUserCounts: number[] = [];
  let activeUsersTotal30d = 0;

  dayKeys.forEach((dayKey) => {
    const summariesCount = summariesByDay.get(dayKey) ?? 0;
    const messagesCount = messagesByDay.get(dayKey) ?? 0;
    const activeUsersCount = activeUsersByDay.get(dayKey) ?? 0;

    runningSummariesTotal += summariesCount;
    messagesTotal30d += messagesCount;
    activeUsersTotal30d += activeUsersCount;
    dailyMessageCounts.push(messagesCount);
    dailyActiveUserCounts.push(activeUsersCount);

    chartPoints.push({
      date: dayKey,
      summaries: runningSummariesTotal,
    });
    messagesChartPoints.push({
      date: dayKey,
      messages: messagesCount,
    });
    activeUsersChartPoints.push({
      date: dayKey,
      activeUsers: activeUsersCount,
    });
  });

  const averagePerDay = messagesTotal30d / dayKeys.length;
  const sortedDailyMessageCounts = [...dailyMessageCounts].sort(
    (a, b) => a - b
  );
  const medianIndex = sortedDailyMessageCounts.length / 2;
  const medianPerDay =
    sortedDailyMessageCounts.length % 2 === 0
      ? (sortedDailyMessageCounts[medianIndex - 1] +
          sortedDailyMessageCounts[medianIndex]) /
        2
      : sortedDailyMessageCounts[Math.floor(medianIndex)];
  const averageActiveUsersPerDay = activeUsersTotal30d / dayKeys.length;
  const sortedDailyActiveUserCounts = [...dailyActiveUserCounts].sort(
    (a, b) => a - b
  );
  const activeUsersMedianIndex = sortedDailyActiveUserCounts.length / 2;
  const medianActiveUsersPerDay =
    sortedDailyActiveUserCounts.length % 2 === 0
      ? (sortedDailyActiveUserCounts[activeUsersMedianIndex - 1] +
          sortedDailyActiveUserCounts[activeUsersMedianIndex]) /
        2
      : sortedDailyActiveUserCounts[Math.floor(activeUsersMedianIndex)];

  return {
    community: {
      ...community,
      chatId: community.chatId.toString(),
    },
    chartPoints,
    messagesChartPoints,
    activeUsersChartPoints,
    topUsersChartPoints,
    totals30d: {
      summaries: runningSummariesTotal,
      messages: messagesTotal30d,
    },
    messagesStats30d: {
      averagePerDay,
      medianPerDay,
    },
    activeUsersStats30d: {
      averagePerDay: averageActiveUsersPerDay,
      medianPerDay: medianActiveUsersPerDay,
    },
  };
}

export async function getCommunityOverviewData(
  communityId: string
): Promise<CommunityOverviewData | null> {
  const getCachedCommunityOverviewData = unstable_cache(
    async () => loadCommunityOverviewData(communityId),
    ["community-overview-data", communityId],
    {
      revalidate: DATA_CACHE_TTL_SECONDS,
      tags: [communityTag(communityId)],
    }
  );

  return getCachedCommunityOverviewData();
}
