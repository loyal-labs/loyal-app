import "server-only";

import {
  appSmartAccountSponsorshipTransactions,
  appUserSmartAccounts,
  appUsers,
  appWalletAuthCompletions,
} from "@loyal-labs/db-core/schema";
import { and, count, desc, eq, gte, lt, sql, sum } from "drizzle-orm";
import { unstable_cache } from "next/cache";

import { getDatabase } from "@/lib/core/database";
import { DATA_CACHE_TTL_SECONDS } from "@/lib/data-cache";

const LAMPORTS_PER_SOL = 1_000_000_000;
const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";
const JUPITER_TOKENS_V2_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";
const TRACKED_SOLANA_ENV = "mainnet";

export type SmartAccountCreationPoint = {
  count: number;
  date: string;
};

export type SmartAccountSpendPoint = {
  amount: number;
  date: string;
  usd: number | null;
};

export type SmartAccountRegistrationRow = {
  id: string;
  registeredAt: string;
  solanaEnv: string;
  userAddress: string;
  vaultAddress: string | null;
};

export type SmartAccountsData = {
  creationPoints: SmartAccountCreationPoint[];
  registrations: SmartAccountRegistrationRow[];
  solPriceUsd: number | null;
  spendPoints: SmartAccountSpendPoint[];
  totalAccounts: number;
  totalCreated30d: number;
  totalSpentSol30d: number;
  totalSpentUsd30d: number | null;
};

type JupiterTokenSearchResult = {
  id?: unknown;
  usdPrice?: unknown;
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

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

const creationDayExpression = sql<string>`
  to_char((date_trunc('day', ${appUserSmartAccounts.createdAt} AT TIME ZONE 'UTC'))::date, 'YYYY-MM-DD')
`;

const spendDayExpression = sql<string>`
  to_char((date_trunc('day', ${appSmartAccountSponsorshipTransactions.occurredAt} AT TIME ZONE 'UTC'))::date, 'YYYY-MM-DD')
`;

async function fetchSolPriceUsd(): Promise<number | null> {
  try {
    const params = new URLSearchParams({ query: NATIVE_SOL_MINT });
    const response = await fetch(
      `${JUPITER_TOKENS_V2_SEARCH_URL}?${params.toString()}`,
      {
        headers: { "Content-Type": "application/json" },
        method: "GET",
      }
    );

    if (!response.ok) {
      return null;
    }

    const tokens = (await response.json()) as unknown;
    if (!Array.isArray(tokens)) {
      return null;
    }

    const sol = tokens.find((token) => token.id === NATIVE_SOL_MINT);
    const price = toNumber(sol?.usdPrice);

    return price && price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function loadSmartAccountsData(): Promise<SmartAccountsData> {
  const db = getDatabase();
  const { startInclusive, endExclusive } = getWindowBoundsUtc();
  const dayKeys = getDayKeys(startInclusive, 30);

  const [
    creationRows,
    totalAccountRows,
    spendRows,
    registrationRows,
    solPriceUsd,
  ] = await Promise.all([
    db
      .select({
        count: count(),
        day: creationDayExpression,
      })
      .from(appUserSmartAccounts)
      .where(
        and(
          eq(appUserSmartAccounts.solanaEnv, TRACKED_SOLANA_ENV),
          eq(appUserSmartAccounts.state, "ready"),
          gte(appUserSmartAccounts.createdAt, startInclusive),
          lt(appUserSmartAccounts.createdAt, endExclusive)
        )
      )
      .groupBy(creationDayExpression),
    db
      .select({ count: count() })
      .from(appUserSmartAccounts)
      .where(
        and(
          eq(appUserSmartAccounts.solanaEnv, TRACKED_SOLANA_ENV),
          eq(appUserSmartAccounts.state, "ready")
        )
      ),
    db
      .select({
        day: spendDayExpression,
        totalLamports: sum(
          appSmartAccountSponsorshipTransactions.spentLamports
        ),
      })
      .from(appSmartAccountSponsorshipTransactions)
      .where(
        and(
          eq(
            appSmartAccountSponsorshipTransactions.solanaEnv,
            TRACKED_SOLANA_ENV
          ),
          gte(
            appSmartAccountSponsorshipTransactions.occurredAt,
            startInclusive
          ),
          lt(appSmartAccountSponsorshipTransactions.occurredAt, endExclusive)
        )
      )
      .groupBy(spendDayExpression),
    db
      .select({
        id: appUserSmartAccounts.id,
        registeredAt: appUserSmartAccounts.createdAt,
        solanaEnv: appUserSmartAccounts.solanaEnv,
        userAddress: sql<string>`coalesce(
          (
            select ${appSmartAccountSponsorshipTransactions.userAddress}
            from ${appSmartAccountSponsorshipTransactions}
            where ${appSmartAccountSponsorshipTransactions.solanaEnv} = ${appUserSmartAccounts.solanaEnv}
              and ${appSmartAccountSponsorshipTransactions.settingsPda} = ${appUserSmartAccounts.settingsPda}
            order by ${appSmartAccountSponsorshipTransactions.occurredAt} desc
            limit 1
          ),
          ${appUsers.subjectAddress}
        )`,
        vaultAddress: sql<string | null>`coalesce(
          (
            select ${appSmartAccountSponsorshipTransactions.smartAccountAddress}
            from ${appSmartAccountSponsorshipTransactions}
            where ${appSmartAccountSponsorshipTransactions.solanaEnv} = ${appUserSmartAccounts.solanaEnv}
              and ${appSmartAccountSponsorshipTransactions.settingsPda} = ${appUserSmartAccounts.settingsPda}
            order by ${appSmartAccountSponsorshipTransactions.occurredAt} desc
            limit 1
          ),
          (
            select ${appWalletAuthCompletions.smartAccountAddress}
            from ${appWalletAuthCompletions}
            where ${appWalletAuthCompletions.userId} = ${appUserSmartAccounts.userId}
              and ${appWalletAuthCompletions.solanaEnv} = ${appUserSmartAccounts.solanaEnv}
              and ${appWalletAuthCompletions.state} = 'completed'
              and ${appWalletAuthCompletions.smartAccountAddress} is not null
            order by ${appWalletAuthCompletions.completedAt} desc nulls last
            limit 1
          ),
          ${appUsers.smartAccountAddress}
        )`,
      })
      .from(appUserSmartAccounts)
      .innerJoin(appUsers, eq(appUsers.id, appUserSmartAccounts.userId))
      .where(
        and(
          eq(appUserSmartAccounts.solanaEnv, TRACKED_SOLANA_ENV),
          eq(appUserSmartAccounts.state, "ready")
        )
      )
      .orderBy(desc(appUserSmartAccounts.createdAt))
      .limit(100),
    fetchSolPriceUsd(),
  ]);

  const createdByDay = new Map(
    creationRows.map((row) => [row.day, Number(row.count) || 0])
  );
  const spentLamportsByDay = new Map(
    spendRows.map((row) => [row.day, toNumber(row.totalLamports) ?? 0])
  );

  const creationPoints: SmartAccountCreationPoint[] = [];
  const spendPoints: SmartAccountSpendPoint[] = [];
  let totalCreated30d = 0;
  let totalSpentLamports30d = 0;

  for (const dayKey of dayKeys) {
    const createdCount = createdByDay.get(dayKey) ?? 0;
    const spentLamports = spentLamportsByDay.get(dayKey) ?? 0;
    const spentSol = spentLamports / LAMPORTS_PER_SOL;
    totalCreated30d += createdCount;
    totalSpentLamports30d += spentLamports;

    creationPoints.push({
      count: createdCount,
      date: dayKey,
    });
    spendPoints.push({
      amount: Number(spentSol.toFixed(6)),
      date: dayKey,
      usd:
        solPriceUsd === null
          ? null
          : Number((spentSol * solPriceUsd).toFixed(2)),
    });
  }

  const totalSpentSol30d = totalSpentLamports30d / LAMPORTS_PER_SOL;

  return {
    creationPoints,
    registrations: registrationRows.map((row) => ({
      ...row,
      registeredAt: row.registeredAt.toISOString(),
    })),
    solPriceUsd,
    spendPoints,
    totalAccounts: Number(totalAccountRows[0]?.count) || 0,
    totalCreated30d,
    totalSpentSol30d: Number(totalSpentSol30d.toFixed(6)),
    totalSpentUsd30d:
      solPriceUsd === null
        ? null
        : Number((totalSpentSol30d * solPriceUsd).toFixed(2)),
  };
}

export async function getSmartAccountsData(): Promise<SmartAccountsData> {
  const getCachedSmartAccountsData = unstable_cache(
    loadSmartAccountsData,
    ["smart-accounts-data"],
    { revalidate: DATA_CACHE_TTL_SECONDS }
  );

  return getCachedSmartAccountsData();
}
