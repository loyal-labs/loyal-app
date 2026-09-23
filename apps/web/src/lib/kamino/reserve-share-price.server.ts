import "server-only";

import {
  calculateKaminoRedeemableLiquidityAmountRaw,
  parseKaminoReserveSnapshot,
  parseKaminoReserveTokenAccounts,
} from "@loyal-labs/smart-account-vaults";
import { type AccountInfo, Connection, PublicKey } from "@solana/web3.js";

import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";

import {
  KAMINO_MAIN_MARKET_USDC_RESERVE,
  resolveEarnForecastCluster,
} from "./earn-forecast.server";
import {
  loadEarnAumWeightsByReserve,
  type ReserveSharePriceRow,
  upsertReserveSharePrices,
} from "./earn-reserve-share-price-repository.server";

const HOUR_MS = 60 * 60 * 1000;
const ACCOUNTS_PER_REQUEST = 100;
// Large probe amount so integer rounding in the redeem calculation is
// negligible relative to the share price.
const SHARE_PRICE_PROBE_COLLATERAL_RAW = BigInt(10) ** BigInt(12);

export function sharePriceFromReserveAccount(data: Buffer): {
  sharePrice: number;
  market: string;
  liquidityMint: string;
} {
  const snapshot = parseKaminoReserveSnapshot(data);
  const accounts = parseKaminoReserveTokenAccounts(data);
  const liquidityRaw = calculateKaminoRedeemableLiquidityAmountRaw({
    collateralAmountRaw: SHARE_PRICE_PROBE_COLLATERAL_RAW,
    snapshot,
  });

  return {
    liquidityMint: accounts.reserveLiquidityMint.toBase58(),
    market: accounts.lendingMarket.toBase58(),
    sharePrice: Number(liquidityRaw) / Number(SHARE_PRICE_PROBE_COLLATERAL_RAW),
  };
}

export type RecordSharePriceDependencies = {
  cluster: string;
  connection: {
    getMultipleAccountsInfoAndContext: (keys: PublicKey[]) => Promise<{
      context: { slot: number };
      value: (Pick<AccountInfo<Buffer>, "data"> | null)[];
    }>;
  };
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
  const reserves = [
    ...new Set([...weights.keys(), KAMINO_MAIN_MARKET_USDC_RESERVE]),
  ];
  const observedHour = new Date(
    Math.floor(deps.now.getTime() / HOUR_MS) * HOUR_MS
  );
  const rows: ReserveSharePriceRow[] = [];
  const missing: string[] = [];

  for (let start = 0; start < reserves.length; start += ACCOUNTS_PER_REQUEST) {
    const chunk = reserves.slice(start, start + ACCOUNTS_PER_REQUEST);
    const { context, value } =
      await deps.connection.getMultipleAccountsInfoAndContext(
        chunk.map((reserve) => new PublicKey(reserve))
      );

    chunk.forEach((reserve, index) => {
      const account = value[index];
      if (!account) {
        missing.push(reserve);
        return;
      }
      try {
        const parsed = sharePriceFromReserveAccount(account.data);
        rows.push({
          ...parsed,
          observedAt: deps.now,
          observedHour,
          reserve,
          slot: context.slot,
        });
      } catch (error) {
        console.warn("[earn-share-price] unparseable reserve", {
          error,
          reserve,
        });
        missing.push(reserve);
      }
    });
  }

  await deps.upsert(deps.cluster, rows);
  return { missing, recorded: rows.length };
}

export async function recordEarnReserveSharePricesNow(
  now = new Date()
): Promise<{ recorded: number; missing: string[] }> {
  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  const { rpcEndpoint } = getServerSolanaEndpoints(solanaEnv);
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
  });

  return recordEarnReserveSharePrices({
    cluster: resolveEarnForecastCluster(),
    connection,
    loadWeights: () => loadEarnAumWeightsByReserve(),
    now,
    upsert: (cluster, rows) => upsertReserveSharePrices(cluster, rows),
  });
}
