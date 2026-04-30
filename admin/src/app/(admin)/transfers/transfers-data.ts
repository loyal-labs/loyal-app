import "server-only";

import {
  gaslessClaimTransactions,
  privateTransferModifyBalanceEvents,
  privateTransferTokenCatalog,
  privateTransferVaultHoldings,
} from "@loyal-labs/db-core/schema";
import { and, eq, gte, lt, sql, sum } from "drizzle-orm";
import { unstable_cache } from "next/cache";

import { getDatabase } from "@/lib/core/database";
import { DATA_CACHE_TTL_SECONDS } from "@/lib/data-cache";

export type ShieldDayPoint = {
  date: string;
  shielded: number;
  unshielded: number;
};

export type ShieldedAsset = {
  priceUsd: number | null;
  symbol: string;
  tokenMint: string;
  totalAmount: number;
  totalValueUsd: number | null;
  userCount: string;
};

export type GaslessClaimPoint = {
  amount: number;
  date: string;
};

export type TransfersData = {
  assets: ShieldedAsset[];
  shieldPoints: ShieldDayPoint[];
  totalShielded: number;
  totalUnshielded: number;
  tvl: number;
};

export type GaslessClaimsData = {
  points: GaslessClaimPoint[];
  totalSpent: number;
};

type HoldingsRow = {
  amountRaw: string;
  decimals: number | null;
  priceUsd: string | null;
  symbol: string | null;
  tokenMint: string;
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

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function amountRawToUi(amountRaw: string, decimals: number | null): number {
  const raw = toNumber(amountRaw) ?? 0;
  const safeDecimals = decimals ?? 0;

  return raw / Math.pow(10, safeDecimals);
}

const LAMPORTS_PER_SOL = 1_000_000_000;

const flowDayExpression = sql<string>`
  to_char((date_trunc('day', ${privateTransferModifyBalanceEvents.occurredAt} AT TIME ZONE 'UTC'))::date, 'YYYY-MM-DD')
`;

const gaslessDayExpression = sql<string>`
  to_char((date_trunc('day', ${gaslessClaimTransactions.occurredAt} AT TIME ZONE 'UTC'))::date, 'YYYY-MM-DD')
`;

async function loadTransfersData(): Promise<TransfersData> {
  const db = getDatabase();
  const { startInclusive, endExclusive } = getWindowBoundsUtc();
  const dayKeys = getDayKeys(startInclusive, 30);

  const [holdingsRows, flowRows, userCountRows] = await Promise.all([
    db
      .select({
        amountRaw: privateTransferVaultHoldings.amountRaw,
        decimals: privateTransferTokenCatalog.decimals,
        priceUsd: privateTransferTokenCatalog.lastPriceUsd,
        symbol: privateTransferTokenCatalog.symbol,
        tokenMint: privateTransferVaultHoldings.tokenMint,
      })
      .from(privateTransferVaultHoldings)
      .leftJoin(
        privateTransferTokenCatalog,
        eq(
          privateTransferTokenCatalog.tokenMint,
          privateTransferVaultHoldings.tokenMint
        )
      ),
    db
      .select({
        day: flowDayExpression,
        shielded: sql<string>`coalesce(sum(
          case when ${privateTransferModifyBalanceEvents.flow} = 'shield'
          then (${privateTransferModifyBalanceEvents.amountRaw}::numeric / power(10, coalesce(${privateTransferTokenCatalog.decimals}, 0))) * coalesce(${privateTransferTokenCatalog.lastPriceUsd}::numeric, 0)
          else 0 end
        ), 0)`,
        unshielded: sql<string>`coalesce(sum(
          case when ${privateTransferModifyBalanceEvents.flow} = 'unshield'
          then (${privateTransferModifyBalanceEvents.amountRaw}::numeric / power(10, coalesce(${privateTransferTokenCatalog.decimals}, 0))) * coalesce(${privateTransferTokenCatalog.lastPriceUsd}::numeric, 0)
          else 0 end
        ), 0)`,
      })
      .from(privateTransferModifyBalanceEvents)
      .leftJoin(
        privateTransferTokenCatalog,
        eq(
          privateTransferTokenCatalog.tokenMint,
          privateTransferModifyBalanceEvents.tokenMint
        )
      )
      .where(
        and(
          gte(privateTransferModifyBalanceEvents.occurredAt, startInclusive),
          lt(privateTransferModifyBalanceEvents.occurredAt, endExclusive)
        )
      )
      .groupBy(flowDayExpression),
    // Count users with net positive balance per token (shield - unshield > 0)
    db
      .select({
        tokenMint: sql<string>`token_mint`,
        userCount: sql<string>`count(*)::text`,
      })
      .from(
        sql`(
          SELECT
            ${privateTransferModifyBalanceEvents.tokenMint} AS token_mint,
            ${privateTransferModifyBalanceEvents.userAddress} AS user_address,
            SUM(CASE WHEN ${privateTransferModifyBalanceEvents.flow} = 'shield' THEN ${privateTransferModifyBalanceEvents.amountRaw}::numeric ELSE 0 END)
            - SUM(CASE WHEN ${privateTransferModifyBalanceEvents.flow} = 'unshield' THEN ${privateTransferModifyBalanceEvents.amountRaw}::numeric ELSE 0 END) AS net_balance
          FROM ${privateTransferModifyBalanceEvents}
          GROUP BY ${privateTransferModifyBalanceEvents.tokenMint}, ${privateTransferModifyBalanceEvents.userAddress}
          HAVING
            SUM(CASE WHEN ${privateTransferModifyBalanceEvents.flow} = 'shield' THEN ${privateTransferModifyBalanceEvents.amountRaw}::numeric ELSE 0 END)
            - SUM(CASE WHEN ${privateTransferModifyBalanceEvents.flow} = 'unshield' THEN ${privateTransferModifyBalanceEvents.amountRaw}::numeric ELSE 0 END) > 0
        ) AS active_users`
      )
      .groupBy(sql`token_mint`),
  ]);

  const userCountByMint = new Map(
    userCountRows.map((row) => [row.tokenMint, row.userCount])
  );

  const assets: ShieldedAsset[] = holdingsRows.map((row: HoldingsRow) => {
    const totalAmount = amountRawToUi(row.amountRaw, row.decimals);
    const priceUsd = toNumber(row.priceUsd);
    const totalValueUsd = priceUsd === null ? null : totalAmount * priceUsd;

    return {
      priceUsd,
      symbol: row.symbol?.trim() || "TOKEN",
      tokenMint: row.tokenMint,
      totalAmount,
      totalValueUsd:
        totalValueUsd === null ? null : Number(totalValueUsd.toFixed(2)),
      userCount: userCountByMint.get(row.tokenMint) ?? "0",
    };
  });

  const flowByDay = new Map(
    flowRows.map((row) => [
      row.day,
      {
        shielded: toNumber(row.shielded) ?? 0,
        unshielded: toNumber(row.unshielded) ?? 0,
      },
    ])
  );

  const points: ShieldDayPoint[] = [];
  let totalShielded = 0;
  let totalUnshielded = 0;

  for (const dayKey of dayKeys) {
    const totals = flowByDay.get(dayKey) ?? { shielded: 0, unshielded: 0 };
    totalShielded += totals.shielded;
    totalUnshielded += totals.unshielded;
    points.push({
      date: dayKey,
      shielded: Number(totals.shielded.toFixed(2)),
      unshielded: Number(totals.unshielded.toFixed(2)),
    });
  }

  const tvl = assets.reduce(
    (sum, asset) => sum + (asset.totalValueUsd ?? 0),
    0
  );

  return {
    assets,
    shieldPoints: points,
    totalShielded: Number(totalShielded.toFixed(2)),
    totalUnshielded: Number(totalUnshielded.toFixed(2)),
    tvl: Number(tvl.toFixed(2)),
  };
}

async function loadGaslessClaimsData(): Promise<GaslessClaimsData> {
  const db = getDatabase();
  const { startInclusive, endExclusive } = getWindowBoundsUtc();
  const dayKeys = getDayKeys(startInclusive, 30);

  const rows = await db
    .select({
      day: gaslessDayExpression,
      totalLamports: sum(gaslessClaimTransactions.spentLamports),
    })
    .from(gaslessClaimTransactions)
    .where(
      and(
        eq(gaslessClaimTransactions.solanaEnv, "mainnet"),
        gte(gaslessClaimTransactions.occurredAt, startInclusive),
        lt(gaslessClaimTransactions.occurredAt, endExclusive)
      )
    )
    .groupBy(gaslessDayExpression);

  const lamportsByDay = new Map(
    rows.map((row) => [row.day, toNumber(row.totalLamports) ?? 0])
  );

  const points: GaslessClaimPoint[] = [];
  let totalSpentLamports = 0;

  for (const dayKey of dayKeys) {
    const spentLamports = lamportsByDay.get(dayKey) ?? 0;
    totalSpentLamports += spentLamports;
    points.push({
      amount: Number((spentLamports / LAMPORTS_PER_SOL).toFixed(6)),
      date: dayKey,
    });
  }

  return {
    points,
    totalSpent: Number((totalSpentLamports / LAMPORTS_PER_SOL).toFixed(6)),
  };
}

export async function getTransfersData(): Promise<TransfersData> {
  const getCachedTransfersData = unstable_cache(
    loadTransfersData,
    ["transfers-data"],
    { revalidate: DATA_CACHE_TTL_SECONDS }
  );

  return getCachedTransfersData();
}

export async function getGaslessClaimsData(): Promise<GaslessClaimsData> {
  const getCachedGaslessClaimsData = unstable_cache(
    loadGaslessClaimsData,
    ["gasless-claims-data"],
    { revalidate: DATA_CACHE_TTL_SECONDS }
  );

  return getCachedGaslessClaimsData();
}

const SOLANA_MAINNET_RPC_URL =
  "https://fredra-z7l52f-fast-mainnet.helius-rpc.com";

async function loadFaucetBalance(): Promise<number | null> {
  const publicKey = process.env.DEPLOYMENT_PUBLIC_KEY;
  if (!publicKey) return null;

  try {
    const response = await fetch(SOLANA_MAINNET_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [publicKey],
      }),
    });

    const data = await response.json();
    if (data.result?.value == null) return null;

    return Number((data.result.value / LAMPORTS_PER_SOL).toFixed(6));
  } catch {
    return null;
  }
}

export async function getFaucetBalance(): Promise<number | null> {
  const getCachedFaucetBalance = unstable_cache(
    loadFaucetBalance,
    ["faucet-balance"],
    { revalidate: DATA_CACHE_TTL_SECONDS }
  );

  return getCachedFaucetBalance();
}
