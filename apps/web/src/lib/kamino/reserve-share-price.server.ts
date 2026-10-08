import "server-only";

import {
  calculateKaminoRedeemableLiquidityAmountRaw,
  parseKaminoReserveSnapshot,
  parseKaminoReserveTokenAccounts,
} from "@loyal-labs/smart-account-vaults";
import { type AccountInfo, Connection, PublicKey } from "@solana/web3.js";

import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";

import {
  KAMINO_MAIN_MARKET_USDC_RESERVE,
  resolveEarnForecastCluster,
  resolveEarnForecastSolanaEnv,
} from "./earn-forecast.server";
import {
  loadEarnAumWeightsByReserve,
  type ReserveSharePriceRow,
  upsertReserveSharePrices,
} from "./earn-reserve-share-price-repository.server";
import {
  getTimescaleReserveDatabaseUrl,
  TimescaleReserveClient,
} from "./timescale-reserve-client.server";

const HOUR_MS = 60 * 60 * 1000;
const MAX_RESERVE_AGE_MS = 3 * HOUR_MS;
const ACCOUNTS_PER_REQUEST = 100;
// Large probe amount so integer rounding in the redeem calculation is
// negligible relative to the share price.
const SHARE_PRICE_PROBE_COLLATERAL_RAW = BigInt(10) ** BigInt(12);

export function sharePriceFromReserveAccount(data: Buffer): {
  sharePrice: number;
  market: string;
  liquidityMint: string;
  collateralSupplyRaw: bigint;
  totalLiquiditySupplyScaled: bigint;
  reserveLastUpdateSlot: number;
  reserveLastUpdateStale: boolean;
} {
  const snapshot = parseKaminoReserveSnapshot(data);
  const accounts = parseKaminoReserveTokenAccounts(data);
  const liquidityRaw = calculateKaminoRedeemableLiquidityAmountRaw({
    collateralAmountRaw: SHARE_PRICE_PROBE_COLLATERAL_RAW,
    snapshot,
  });

  return {
    collateralSupplyRaw: snapshot.collateralSupplyRaw,
    liquidityMint: accounts.reserveLiquidityMint.toBase58(),
    market: accounts.lendingMarket.toBase58(),
    sharePrice: Number(liquidityRaw) / Number(SHARE_PRICE_PROBE_COLLATERAL_RAW),
    totalLiquiditySupplyScaled: snapshot.totalLiquiditySupplyScaled,
    // Kamino Reserve: 8-byte discriminator, u64 version, then LastUpdate
    // (u64 slot, u8 stale). Decode only after the SDK validates the account.
    reserveLastUpdateSlot: Number(data.readBigUInt64LE(16)),
    reserveLastUpdateStale: data[24] !== 0,
  };
}

export type RecordSharePriceDependencies = {
  cluster: string;
  connection: {
    getBlockTime: (slot: number) => Promise<number | null>;
    getMultipleAccountsInfoAndContext: (keys: PublicKey[]) => Promise<{
      context: { slot: number };
      value: (Pick<AccountInfo<Buffer>, "data"> | null)[];
    }>;
  };
  loadCandidateReserves: () => Promise<string[]>;
  loadWeights: () => Promise<Map<string, number>>;
  now: Date;
  upsert: (
    cluster: string,
    rows: readonly ReserveSharePriceRow[]
  ) => Promise<void>;
};

export async function recordEarnReserveSharePrices(
  deps: RecordSharePriceDependencies
): Promise<{ recorded: number; missing: string[] }> {
  const weights = await deps.loadWeights();
  const candidates = await deps.loadCandidateReserves();
  const reserves = [
    ...new Set([
      ...weights.keys(),
      ...candidates,
      KAMINO_MAIN_MARKET_USDC_RESERVE,
    ]),
  ];
  const rows: ReserveSharePriceRow[] = [];
  const missing: string[] = [];
  const blockTimes = new Map<number, number | null>();

  for (let start = 0; start < reserves.length; start += ACCOUNTS_PER_REQUEST) {
    const chunk = reserves.slice(start, start + ACCOUNTS_PER_REQUEST);
    const { context, value } =
      await deps.connection.getMultipleAccountsInfoAndContext(
        chunk.map((reserve) => new PublicKey(reserve))
      );

    for (const [index, reserve] of chunk.entries()) {
      const account = value[index];
      if (!account) {
        missing.push(reserve);
        continue;
      }
      try {
        const parsed = sharePriceFromReserveAccount(account.data);
        if (
          parsed.collateralSupplyRaw === BigInt(0) ||
          parsed.totalLiquiditySupplyScaled === BigInt(0) ||
          !Number.isFinite(parsed.sharePrice) ||
          parsed.sharePrice <= 0 ||
          parsed.reserveLastUpdateStale ||
          !Number.isSafeInteger(parsed.reserveLastUpdateSlot) ||
          parsed.reserveLastUpdateSlot <= 0 ||
          parsed.reserveLastUpdateSlot > context.slot
        ) {
          missing.push(reserve);
          continue;
        }
        const updateSlot = parsed.reserveLastUpdateSlot;
        if (!blockTimes.has(updateSlot)) {
          blockTimes.set(
            updateSlot,
            await deps.connection.getBlockTime(updateSlot)
          );
        }
        const blockTime = blockTimes.get(updateSlot);
        const observedAtMs = blockTime == null ? NaN : blockTime * 1000;
        if (
          !Number.isFinite(observedAtMs) ||
          observedAtMs > deps.now.getTime() ||
          deps.now.getTime() - observedAtMs > MAX_RESERVE_AGE_MS
        ) {
          missing.push(reserve);
          continue;
        }
        rows.push({
          liquidityMint: parsed.liquidityMint,
          market: parsed.market,
          // Timestamp the actual reserve state, not the time it was polled.
          observedAt: new Date(observedAtMs),
          observedHour: new Date(Math.floor(observedAtMs / HOUR_MS) * HOUR_MS),
          reserve,
          sharePrice: parsed.sharePrice,
          slot: updateSlot,
        });
      } catch (error) {
        console.warn("[earn-share-price] unavailable reserve observation", {
          error,
          reserve,
        });
        missing.push(reserve);
      }
    }
  }

  await deps.upsert(deps.cluster, rows);
  return { missing, recorded: rows.length };
}

// extraReserves widens the probe to reserves the caller knows hold Earn
// capital, so every recorded allocation has prices to weight.
export async function recordEarnReserveSharePricesNow(
  now = new Date(),
  extraReserves: readonly string[] = []
): Promise<{ recorded: number; missing: string[] }> {
  const { rpcEndpoint } = getServerSolanaEndpoints(
    resolveEarnForecastSolanaEnv()
  );
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
  });

  return recordEarnReserveSharePrices({
    cluster: resolveEarnForecastCluster(),
    connection,
    loadCandidateReserves: async () => [
      ...(await loadCandidateSupportedStableReserves()),
      ...extraReserves,
    ],
    loadWeights: () => loadEarnAumWeightsByReserve(),
    now,
    upsert: (cluster, rows) => upsertReserveSharePrices(cluster, rows),
  });
}

// Best-effort: the candidate universe only widens what we probe, so a
// Timescale outage must never fail the hourly recording cron.
async function loadCandidateSupportedStableReserves(): Promise<string[]> {
  const databaseUrl = getTimescaleReserveDatabaseUrl();
  if (!databaseUrl) {
    return [];
  }

  const client = new TimescaleReserveClient({
    databaseUrl,
    maxConnections: 1,
  });
  try {
    const supportedReserves = await client.getMediumStableSupportedReserves();
    return supportedReserves.map((reserve) => reserve.reserve);
  } catch (error) {
    console.warn("[earn-share-price] candidate reserves unavailable", error);
    return [];
  } finally {
    await client.close();
  }
}
