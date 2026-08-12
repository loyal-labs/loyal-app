import {
  getKaminoUsdcEarnTargetForCluster,
  RiskBasket,
  resolveLoyalClusterForSolanaEnv,
} from "@loyal-labs/actions";
import { parseKaminoReserveTokenAccounts } from "@loyal-labs/smart-account-vaults";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveLoyalWebSolanaEnvFromEnv } from "../src/lib/core/config/solana-env-override";
import {
  type CurrentEligibleSafeReserve,
  getTimescaleReserveDatabaseUrl,
  type TimescaleReserveApySample,
  TimescaleReserveClient,
} from "../src/lib/kamino/timescale-reserve-client.server";
import {
  EARN_ENABLED_STABLECOINS_ENV_NAME,
  type EarnProductAsset,
  getEarnProductAssetsForCluster,
  parseEnabledEarnStablecoins,
} from "../src/lib/yield-optimization/earn-product-mints.shared";

const APY_FRESHNESS_MS = 36 * 60 * 60 * 1000;
const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function explicitRpcEndpoint(solanaEnv: "mainnet" | "devnet") {
  return solanaEnv === "mainnet"
    ? process.env.SOLANA_MAINNET_RPC_URL?.trim() ||
        process.env.SOLANA_RPC_URL?.trim()
    : process.env.SOLANA_DEVNET_RPC_URL?.trim();
}

async function verifyReserveIdentity(args: {
  asset: EarnProductAsset;
  connection: Connection | null;
  klendProgramId: PublicKey;
  selected: CurrentEligibleSafeReserve | null;
}): Promise<{
  blocker: string | null;
  status: "ready" | "blocked" | "unknown";
}> {
  if (!args.selected) {
    return { blocker: null, status: "unknown" };
  }
  if (!args.connection) {
    return {
      blocker: "reserve identity is unknown without explicit RPC",
      status: "unknown",
    };
  }
  if (!args.selected.market) {
    return { blocker: "selected reserve has no market", status: "blocked" };
  }
  try {
    const account = await args.connection.getAccountInfo(
      new PublicKey(args.selected.reserve),
      "confirmed"
    );
    if (!account) {
      return {
        blocker: "selected reserve account is missing",
        status: "blocked",
      };
    }
    const decoded = parseKaminoReserveTokenAccounts(account.data);
    const valid =
      account.owner.equals(args.klendProgramId) &&
      decoded.lendingMarket.equals(new PublicKey(args.selected.market)) &&
      decoded.reserveLiquidityMint.equals(args.asset.mint) &&
      decoded.reserveLiquidityTokenProgram.equals(args.asset.tokenProgramId);
    return valid
      ? { blocker: null, status: "ready" }
      : { blocker: "selected reserve identity mismatch", status: "blocked" };
  } catch {
    return {
      blocker: "selected reserve RPC read failed",
      status: "unknown",
    };
  }
}

async function buildProductReport(args: {
  asset: EarnProductAsset;
  connection: Connection | null;
  eligibleRows: CurrentEligibleSafeReserve[] | null;
  enabledStablecoins: readonly string[];
  history: readonly (TimescaleReserveApySample & { reserve: string })[];
  klendProgramId: PublicKey;
  now: Date;
}) {
  const mint = args.asset.mint.toBase58();
  const rows = (args.eligibleRows ?? []).filter(
    (row) => row.liquidityMint === mint
  );
  const selected = rows[0] ?? null;
  const productBlockers: string[] = [];
  if (!args.eligibleRows) {
    productBlockers.push("eligible reserve feed is unknown");
  } else if (!selected) {
    productBlockers.push("no eligible Safe reserve");
  }
  const reserveIdentity = await verifyReserveIdentity({
    asset: args.asset,
    connection: args.connection,
    klendProgramId: args.klendProgramId,
    selected,
  });
  if (reserveIdentity.blocker) {
    productBlockers.push(reserveIdentity.blocker);
  }
  const sampleCount = selected
    ? args.history.filter((sample) => sample.reserve === selected.reserve)
        .length
    : 0;
  const currentAgeMs = selected
    ? Math.max(0, args.now.getTime() - selected.observedAt.getTime())
    : null;
  const apyFresh = currentAgeMs !== null && currentAgeMs <= APY_FRESHNESS_MS;
  if (selected && !apyFresh) {
    productBlockers.push("current APY observation is stale");
  }
  if (selected && sampleCount === 0) {
    productBlockers.push("APY history coverage is missing");
  }
  return {
    apy: selected?.supplyApy ?? null,
    apyCurrentAgeMs: currentAgeMs,
    apyCurrentFresh: selected ? apyFresh : null,
    apyHistorySampleCount: selected ? sampleCount : null,
    blockers: productBlockers,
    depositEnabled: args.enabledStablecoins.includes(args.asset.stablecoin),
    eligibleSafeReserveCount: args.eligibleRows ? rows.length : null,
    mint,
    reserveIdentity: reserveIdentity.status,
    selectedMarket: selected?.market ?? null,
    selectedReserve: selected?.reserve ?? null,
    symbol: args.asset.symbol,
    tokenProgram: args.asset.tokenProgramId.toBase58(),
  };
}

async function main() {
  const now = new Date();
  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  const enabledStablecoins = parseEnabledEarnStablecoins(
    process.env[EARN_ENABLED_STABLECOINS_ENV_NAME]
  );
  const assets = getEarnProductAssetsForCluster(cluster);
  const databaseUrl = getTimescaleReserveDatabaseUrl();
  const rpcEndpoint = explicitRpcEndpoint(solanaEnv);
  const blockers: string[] = [];
  if (!databaseUrl) {
    blockers.push("TIMESCALEDB_URL is not configured");
  }
  if (!rpcEndpoint) {
    blockers.push(`explicit ${solanaEnv} RPC is not configured`);
  }

  const client = databaseUrl
    ? new TimescaleReserveClient({ databaseUrl, maxConnections: 1 })
    : null;
  try {
    const eligibleRows = client
      ? await client.getCurrentEligibleSafeReserves({
          riskProfile: RiskBasket.Safe,
        })
      : null;
    const selectedRows = assets.flatMap((asset) => {
      const rows = (eligibleRows ?? []).filter(
        (row) => row.liquidityMint === asset.mint.toBase58()
      );
      return rows[0] ? [[asset.mint.toBase58(), rows[0]] as const] : [];
    });
    const history =
      client && selectedRows.length > 0
        ? await client.getReserveApyHistorySamplesForReserves({
            end: now,
            reserves: selectedRows.map(([, row]) => row.reserve),
            start: new Date(now.getTime() - HISTORY_WINDOW_MS),
          })
        : [];
    const connection = rpcEndpoint
      ? new Connection(rpcEndpoint, "confirmed")
      : null;
    const klendProgramId =
      getKaminoUsdcEarnTargetForCluster(cluster).lendProgramId;

    const products = await Promise.all(
      assets.map((asset) =>
        buildProductReport({
          asset,
          connection,
          eligibleRows,
          enabledStablecoins,
          history,
          klendProgramId,
          now,
        })
      )
    );
    const dataReady = products.every(
      (product) =>
        !product.depositEnabled ||
        (product.blockers.length === 0 && product.reserveIdentity === "ready")
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          blockers,
          cluster,
          generatedAt: now.toISOString(),
          mode: "read_only",
          products,
          releaseState: {
            canaryFinalized: false,
            codeVerified: "not_assessed_by_this_command",
            dataReady: blockers.length === 0 ? dataReady : "unknown",
            deployed: false,
            userReady: false,
          },
          solanaEnv,
        },
        null,
        2
      )}\n`
    );
  } finally {
    await client?.close();
  }
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      error: error instanceof Error ? error.message : "readiness check failed",
      mode: "read_only",
      userReady: false,
    })}\n`
  );
  process.exitCode = 1;
});
