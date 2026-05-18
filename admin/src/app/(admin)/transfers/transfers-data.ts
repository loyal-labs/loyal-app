import "server-only";

import {
  type PrivateTransferAnalyticsFlow,
  gaslessClaimTransactions,
  privateTransferModifyBalanceEvents,
  privateTransferTokenCatalog,
  privateTransferVaultHoldings,
} from "@loyal-labs/db-core/schema";
import { and, eq, gte, lt, sql, sum } from "drizzle-orm";
import { unstable_cache } from "next/cache";

import { getDatabase } from "@/lib/core/database";
import { DATA_CACHE_TTL_SECONDS } from "@/lib/data-cache";
import { fetchTokenPricesByMints } from "@/lib/market/token-prices.server";

const SOLANA_MAINNET_RPC_URL =
  "https://guendolen-nvqjc4-fast-mainnet.helius-rpc.com";
const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const KAMINO_USDC_RESERVE = "9GJ9GBRwCp4pHmWrQ43L5xpc9Vykg7jnfwcFGN8FoHYu";
const KAMINO_USDC_COLLATERAL_MINT =
  "DKaVQFXD6Qz4USTkRWyPun3oU6r1RfYsWJ8YqLpnSnN5";
// findVaultPda(["vault", USDC_MINT_MAINNET], telegram-private-transfer program)
const PRIVATE_TRANSFER_USDC_VAULT =
  "5KhwG5iTyQB1PietJKBV7reqBejSteRazuRLu2VnhFK2";
const USDC_DECIMALS = 6;
const USDC_PRICE_USD = 1;
const USDC_SYMBOL = "USDC";
const KAMINO_RESERVE_DISCRIMINATOR = Buffer.from([
  43, 242, 204, 202, 26, 247, 59, 127,
]);
const KAMINO_FRACTION_BITS = BigInt(60);
const KAMINO_FRACTION_SCALE = BigInt(1) << KAMINO_FRACTION_BITS;
const KAMINO_RESERVE_LAYOUT_OFFSETS = {
  collateralMintTotalSupply: 2584,
  liquidityAccumulatedProtocolFeesSf: 336,
  liquidityAccumulatedReferrerFeesSf: 352,
  liquidityAvailableAmount: 216,
  liquidityBorrowedAmountSf: 224,
  liquidityPendingReferrerFeesSf: 368,
} as const;

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

type FlowRow = {
  amountRaw: string | null;
  day: string;
  decimals: number | null;
  flow: PrivateTransferAnalyticsFlow;
  priceUsd: string | null;
  tokenMint: string;
};

type PriceSourceRow = {
  priceUsd: string | null;
  tokenMint: string;
};

type RpcResponse<T> = {
  error?: { message?: string };
  result?: T;
};

type ParsedTokenAccountsResult = {
  value?: Array<{
    account?: {
      data?: {
        parsed?: {
          info?: {
            mint?: string;
            owner?: string;
            tokenAmount?: {
              amount?: string;
            };
          };
        };
      };
    };
  }>;
};

type AccountInfoResult = {
  value?: {
    data?: [string, string];
  } | null;
};

type AssetAccumulator = {
  amountRaw: bigint;
  decimals: number | null;
  priceUsd: number | null;
  symbol: string;
  tokenMint: string;
};

type KaminoReserveSnapshot = {
  collateralSupplyRaw: bigint;
  totalLiquiditySupplyScaled: bigint;
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

async function callSolanaMainnetRpc<T>(
  method: string,
  params: unknown[]
): Promise<T> {
  const response = await fetch(SOLANA_MAINNET_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: method,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`Solana RPC ${method} failed with ${response.status}`);
  }

  const payload = (await response.json()) as RpcResponse<T>;
  if (payload.error) {
    throw new Error(
      payload.error.message ?? `Solana RPC ${method} returned an error`
    );
  }
  if (payload.result === undefined) {
    throw new Error(`Solana RPC ${method} returned no result`);
  }

  return payload.result;
}

function readUint64LE(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset);
}

function readUint128LE(data: Buffer, offset: number): bigint {
  const low = data.readBigUInt64LE(offset);
  const high = data.readBigUInt64LE(offset + 8);
  return low + (high << BigInt(64));
}

// TODO: remove duplication with SDK
function parseKaminoReserveSnapshot(data: Buffer): KaminoReserveSnapshot {
  if (
    data.length < 8 ||
    !data.subarray(0, 8).equals(KAMINO_RESERVE_DISCRIMINATOR)
  ) {
    throw new Error("Kamino USDC reserve has an invalid discriminator");
  }

  const accountData = data.subarray(8);
  const liquidityAvailableAmount = readUint64LE(
    accountData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityAvailableAmount
  );
  const liquidityBorrowedAmountSf = readUint128LE(
    accountData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityBorrowedAmountSf
  );
  const liquidityAccumulatedProtocolFeesSf = readUint128LE(
    accountData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityAccumulatedProtocolFeesSf
  );
  const liquidityAccumulatedReferrerFeesSf = readUint128LE(
    accountData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityAccumulatedReferrerFeesSf
  );
  const liquidityPendingReferrerFeesSf = readUint128LE(
    accountData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.liquidityPendingReferrerFeesSf
  );
  const collateralSupplyRaw = readUint64LE(
    accountData,
    KAMINO_RESERVE_LAYOUT_OFFSETS.collateralMintTotalSupply
  );

  const grossLiquiditySupplyScaled =
    (liquidityAvailableAmount << KAMINO_FRACTION_BITS) +
    liquidityBorrowedAmountSf;
  const totalFeeAmountScaled =
    liquidityAccumulatedProtocolFeesSf +
    liquidityAccumulatedReferrerFeesSf +
    liquidityPendingReferrerFeesSf;

  return {
    collateralSupplyRaw,
    totalLiquiditySupplyScaled:
      grossLiquiditySupplyScaled > totalFeeAmountScaled
        ? grossLiquiditySupplyScaled - totalFeeAmountScaled
        : BigInt(0),
  };
}

function calculateKaminoRedeemableLiquidityAmountRaw(
  snapshot: KaminoReserveSnapshot,
  collateralSharesAmountRaw: bigint
): bigint {
  if (collateralSharesAmountRaw <= BigInt(0)) {
    return BigInt(0);
  }

  if (
    snapshot.collateralSupplyRaw === BigInt(0) ||
    snapshot.totalLiquiditySupplyScaled === BigInt(0)
  ) {
    return collateralSharesAmountRaw;
  }

  return (
    (collateralSharesAmountRaw * snapshot.totalLiquiditySupplyScaled) /
    (snapshot.collateralSupplyRaw * KAMINO_FRACTION_SCALE)
  );
}

function getParsedTokenAmountRaw(
  account: NonNullable<ParsedTokenAccountsResult["value"]>[number],
  mint: string
): bigint {
  const info = account.account?.data?.parsed?.info;
  if (info?.mint !== mint || info.owner !== PRIVATE_TRANSFER_USDC_VAULT) {
    return BigInt(0);
  }

  return BigInt(info.tokenAmount?.amount ?? "0");
}

async function getVaultTokenAmountRaw(mint: string): Promise<bigint> {
  const result = await callSolanaMainnetRpc<ParsedTokenAccountsResult>(
    "getTokenAccountsByOwner",
    [
      PRIVATE_TRANSFER_USDC_VAULT,
      { mint },
      { commitment: "confirmed", encoding: "jsonParsed" },
    ]
  );

  return (result.value ?? []).reduce(
    (sum, account) => sum + getParsedTokenAmountRaw(account, mint),
    BigInt(0)
  );
}

async function loadKaminoVaultUsdcAmountRaw(): Promise<bigint | null> {
  const [liquidityAmountRaw, collateralSharesAmountRaw, reserveResult] =
    await Promise.all([
      getVaultTokenAmountRaw(USDC_MINT_MAINNET),
      getVaultTokenAmountRaw(KAMINO_USDC_COLLATERAL_MINT),
      callSolanaMainnetRpc<AccountInfoResult>("getAccountInfo", [
        KAMINO_USDC_RESERVE,
        { commitment: "confirmed", encoding: "base64" },
      ]),
    ]);

  const reserveData = reserveResult.value?.data?.[0];
  if (!reserveData) {
    return null;
  }

  const snapshot = parseKaminoReserveSnapshot(
    Buffer.from(reserveData, "base64")
  );

  return (
    liquidityAmountRaw +
    calculateKaminoRedeemableLiquidityAmountRaw(
      snapshot,
      collateralSharesAmountRaw
    )
  );
}

function addAssetAmount(
  assetsByMint: Map<string, AssetAccumulator>,
  row: {
    amountRaw: bigint;
    decimals: number | null;
    priceUsd: number | null;
    symbol: string | null;
    tokenMint: string;
  }
) {
  const existing = assetsByMint.get(row.tokenMint);
  if (!existing) {
    assetsByMint.set(row.tokenMint, {
      amountRaw: row.amountRaw,
      decimals: row.decimals,
      priceUsd: row.priceUsd,
      symbol: row.symbol?.trim() || "TOKEN",
      tokenMint: row.tokenMint,
    });
    return;
  }

  existing.amountRaw += row.amountRaw;
  existing.decimals ??= row.decimals;
  existing.priceUsd ??= row.priceUsd;
  if (existing.symbol === "TOKEN" && row.symbol?.trim()) {
    existing.symbol = row.symbol.trim();
  }
}

function getMintsWithMissingPrices(priceRows: PriceSourceRow[]): string[] {
  return Array.from(
    new Set(
      priceRows
        .filter((row) => toNumber(row.priceUsd) === null)
        .map((row) => row.tokenMint)
        .filter(Boolean)
    )
  );
}

async function loadLivePricesForMissingCatalogRows(
  priceRows: PriceSourceRow[]
): Promise<Map<string, number>> {
  const missingPriceMints = getMintsWithMissingPrices(priceRows);
  if (missingPriceMints.length === 0) {
    return new Map();
  }

  return fetchTokenPricesByMints(missingPriceMints);
}

function buildShieldedAssets(args: {
  holdingsRows: HoldingsRow[];
  kaminoVaultUsdcAmountRaw: bigint | null;
  livePriceByMint: Map<string, number>;
  userCountByMint: Map<string, string>;
}): ShieldedAsset[] {
  const assetsByMint = new Map<string, AssetAccumulator>();
  const hasLiveKaminoUsdc = args.kaminoVaultUsdcAmountRaw !== null;

  for (const row of args.holdingsRows) {
    if (
      hasLiveKaminoUsdc &&
      (row.tokenMint === USDC_MINT_MAINNET ||
        row.tokenMint === KAMINO_USDC_COLLATERAL_MINT)
    ) {
      continue;
    }

    addAssetAmount(assetsByMint, {
      amountRaw: BigInt(row.amountRaw),
      decimals: row.decimals,
      priceUsd:
        toNumber(row.priceUsd) ??
        args.livePriceByMint.get(row.tokenMint) ??
        null,
      symbol: row.symbol,
      tokenMint: row.tokenMint,
    });
  }

  if (args.kaminoVaultUsdcAmountRaw !== null) {
    const usdcCatalogRow = args.holdingsRows.find(
      (row) => row.tokenMint === USDC_MINT_MAINNET
    );
    addAssetAmount(assetsByMint, {
      amountRaw: args.kaminoVaultUsdcAmountRaw,
      decimals: usdcCatalogRow?.decimals ?? USDC_DECIMALS,
      priceUsd: toNumber(usdcCatalogRow?.priceUsd) ?? USDC_PRICE_USD,
      symbol: usdcCatalogRow?.symbol ?? USDC_SYMBOL,
      tokenMint: USDC_MINT_MAINNET,
    });
  }

  return Array.from(assetsByMint.values()).map((asset) => {
    const totalAmount = amountRawToUi(
      asset.amountRaw.toString(),
      asset.decimals
    );
    const totalValueUsd =
      asset.priceUsd === null ? null : totalAmount * asset.priceUsd;

    return {
      priceUsd: asset.priceUsd,
      symbol: asset.symbol,
      tokenMint: asset.tokenMint,
      totalAmount,
      totalValueUsd:
        totalValueUsd === null ? null : Number(totalValueUsd.toFixed(2)),
      userCount: args.userCountByMint.get(asset.tokenMint) ?? "0",
    };
  });
}

function buildShieldFlowPoints(args: {
  dayKeys: string[];
  flowRows: FlowRow[];
  livePriceByMint: Map<string, number>;
}): {
  points: ShieldDayPoint[];
  totalShielded: number;
  totalUnshielded: number;
} {
  const flowByDay = new Map<string, { shielded: number; unshielded: number }>();

  for (const row of args.flowRows) {
    const priceUsd =
      toNumber(row.priceUsd) ?? args.livePriceByMint.get(row.tokenMint) ?? null;
    if (priceUsd === null) {
      continue;
    }

    const amountUsd =
      amountRawToUi(row.amountRaw ?? "0", row.decimals) * priceUsd;
    const totals = flowByDay.get(row.day) ?? { shielded: 0, unshielded: 0 };
    if (row.flow === "shield") {
      totals.shielded += amountUsd;
    } else {
      totals.unshielded += amountUsd;
    }
    flowByDay.set(row.day, totals);
  }

  const points: ShieldDayPoint[] = [];
  let totalShielded = 0;
  let totalUnshielded = 0;

  for (const dayKey of args.dayKeys) {
    const totals = flowByDay.get(dayKey) ?? { shielded: 0, unshielded: 0 };
    totalShielded += totals.shielded;
    totalUnshielded += totals.unshielded;
    points.push({
      date: dayKey,
      shielded: Number(totals.shielded.toFixed(2)),
      unshielded: Number(totals.unshielded.toFixed(2)),
    });
  }

  return {
    points,
    totalShielded: Number(totalShielded.toFixed(2)),
    totalUnshielded: Number(totalUnshielded.toFixed(2)),
  };
}

async function loadTransfersData(): Promise<TransfersData> {
  const db = getDatabase();
  const { startInclusive, endExclusive } = getWindowBoundsUtc();
  const dayKeys = getDayKeys(startInclusive, 30);

  const [holdingsRows, flowRows, userCountRows, kaminoVaultUsdcAmountRaw] =
    await Promise.all([
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
          amountRaw: sum(privateTransferModifyBalanceEvents.amountRaw),
          day: flowDayExpression,
          decimals: privateTransferTokenCatalog.decimals,
          flow: privateTransferModifyBalanceEvents.flow,
          priceUsd: privateTransferTokenCatalog.lastPriceUsd,
          tokenMint: privateTransferModifyBalanceEvents.tokenMint,
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
        .groupBy(
          flowDayExpression,
          privateTransferModifyBalanceEvents.flow,
          privateTransferModifyBalanceEvents.tokenMint,
          privateTransferTokenCatalog.decimals,
          privateTransferTokenCatalog.lastPriceUsd
        ),
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
      loadKaminoVaultUsdcAmountRaw().catch((error) => {
        console.error(
          "[transfers-data] Failed to load Kamino USDC vault balance",
          error
        );
        return null;
      }),
    ]);

  const userCountByMint = new Map(
    userCountRows.map((row) => [row.tokenMint, row.userCount])
  );
  const livePriceByMint = await loadLivePricesForMissingCatalogRows([
    ...holdingsRows,
    ...flowRows,
  ]).catch((error) => {
    console.error(
      "[transfers-data] Failed to load CoinGecko token prices",
      error
    );
    return new Map<string, number>();
  });

  const assets = buildShieldedAssets({
    holdingsRows,
    kaminoVaultUsdcAmountRaw,
    livePriceByMint,
    userCountByMint,
  });

  const { points, totalShielded, totalUnshielded } = buildShieldFlowPoints({
    dayKeys,
    flowRows,
    livePriceByMint,
  });

  const tvl = assets.reduce(
    (sum, asset) => sum + (asset.totalValueUsd ?? 0),
    0
  );

  return {
    assets,
    shieldPoints: points,
    totalShielded,
    totalUnshielded,
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
