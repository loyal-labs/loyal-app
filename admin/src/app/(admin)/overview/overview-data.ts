import "server-only";

import { unstable_cache } from "next/cache";
import { and, count, gte, lt, sql } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";
import { CACHE_TAGS, DATA_CACHE_TTL_SECONDS } from "@/lib/data-cache";
import {
  communities,
  messages,
  summaries,
  users,
} from "@loyal-labs/db-core/schema";

export type OverviewChartPoint = {
  date: string;
  summaries: number;
};

export type CommunityGrowthChartPoint = {
  date: string;
  communities: number;
};

export type OverviewTotals = {
  summaries: number;
  messages: number;
};

export type CommunityGrowthTotals = {
  communities: number;
  users: number;
};

export type OverviewData = {
  chartPoints: OverviewChartPoint[];
  totals30d: OverviewTotals;
  communitiesChartPoints: CommunityGrowthChartPoint[];
  communitiesTotals30d: CommunityGrowthTotals;
};

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

async function loadOverviewData(): Promise<OverviewData> {
  const db = getDatabase();
  const { startInclusive, endExclusive } = getWindowBoundsUtc();
  const dayKeys = getDayKeys(startInclusive, 30);

  const summariesDayExpression = sql<string>`
    to_char((date_trunc('day', ${summaries.createdAt} AT TIME ZONE 'UTC'))::date, 'YYYY-MM-DD')
  `;
  const messagesDayExpression = sql<string>`
    to_char((date_trunc('day', ${messages.createdAt} AT TIME ZONE 'UTC'))::date, 'YYYY-MM-DD')
  `;
  const communitiesDayExpression = sql<string>`
    to_char((date_trunc('day', ${communities.updatedAt} AT TIME ZONE 'UTC'))::date, 'YYYY-MM-DD')
  `;
  const usersDayExpression = sql<string>`
    to_char((date_trunc('day', ${users.createdAt} AT TIME ZONE 'UTC'))::date, 'YYYY-MM-DD')
  `;

  const [summaryRows, messageRows, communityRows, userRows] = await Promise.all(
    [
      db
        .select({
          day: summariesDayExpression,
          count: count(),
        })
        .from(summaries)
        .where(
          and(
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
            gte(messages.createdAt, startInclusive),
            lt(messages.createdAt, endExclusive)
          )
        )
        .groupBy(messagesDayExpression),
      db
        .select({
          day: communitiesDayExpression,
          count: count(),
        })
        .from(communities)
        .where(
          and(
            gte(communities.updatedAt, startInclusive),
            lt(communities.updatedAt, endExclusive)
          )
        )
        .groupBy(communitiesDayExpression),
      db
        .select({
          day: usersDayExpression,
          count: count(),
        })
        .from(users)
        .where(
          and(
            gte(users.createdAt, startInclusive),
            lt(users.createdAt, endExclusive)
          )
        )
        .groupBy(usersDayExpression),
    ]
  );

  const summariesByDay = new Map(
    summaryRows.map((row) => [row.day, Number(row.count) || 0])
  );
  const messagesByDay = new Map(
    messageRows.map((row) => [row.day, Number(row.count) || 0])
  );
  const communitiesByDay = new Map(
    communityRows.map((row) => [row.day, Number(row.count) || 0])
  );
  const usersByDay = new Map(
    userRows.map((row) => [row.day, Number(row.count) || 0])
  );

  let runningSummariesTotal = 0;
  let messagesTotal30d = 0;
  let runningCommunitiesTotal = 0;
  let usersTotal30d = 0;

  const chartPoints: OverviewChartPoint[] = [];
  const communitiesChartPoints: CommunityGrowthChartPoint[] = [];

  dayKeys.forEach((dayKey) => {
    const summariesCount = summariesByDay.get(dayKey) ?? 0;
    const messagesCount = messagesByDay.get(dayKey) ?? 0;
    const communitiesCount = communitiesByDay.get(dayKey) ?? 0;
    const usersCount = usersByDay.get(dayKey) ?? 0;

    runningSummariesTotal += summariesCount;
    messagesTotal30d += messagesCount;
    runningCommunitiesTotal += communitiesCount;
    usersTotal30d += usersCount;

    chartPoints.push({
      date: dayKey,
      summaries: runningSummariesTotal,
    });
    communitiesChartPoints.push({
      date: dayKey,
      communities: runningCommunitiesTotal,
    });
  });

  return {
    chartPoints,
    totals30d: {
      summaries: runningSummariesTotal,
      messages: messagesTotal30d,
    },
    communitiesChartPoints,
    communitiesTotals30d: {
      communities: runningCommunitiesTotal,
      users: usersTotal30d,
    },
  };
}

const getCachedOverviewData = unstable_cache(
  loadOverviewData,
  ["overview-data"],
  {
    revalidate: DATA_CACHE_TTL_SECONDS,
    tags: [CACHE_TAGS.overview],
  }
);

export async function getOverviewData(): Promise<OverviewData> {
  return getCachedOverviewData();
}
