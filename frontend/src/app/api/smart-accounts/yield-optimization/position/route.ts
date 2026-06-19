import { NextResponse } from "next/server";
import {
  LoyalCluster,
  getKaminoUsdcEarnTargetForCluster,
  resolveLoyalClusterForSolanaEnv,
} from "@loyal-labs/actions";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import {
  getCurrentReserveUpdatesByReserve,
  type TimescaleReserveUpdateRow,
} from "@/lib/kamino/timescale-reserve-client.server";
import { resolveEarnPositionDisplay } from "@/lib/yield-optimization/earn-position-display";
import {
  findCurrentNonzeroYieldVaultReservePositions,
  findCurrentYieldVaultIdleTokenBalances,
  findReconciledActiveYieldPositionForVault,
  type CurrentYieldVaultIdleTokenBalanceRecord,
  type CurrentYieldVaultReservePositionRecord,
  type UserYieldPositionRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

const EARN_VAULT_INDEX = 1;
const CURRENT_RESERVE_LOOKUP_RETRIES = 2;
const CURRENT_RESERVE_LOOKUP_RETRY_DELAY_MS = 250;

function resolveConfiguredCluster() {
  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  return resolveLoyalClusterForSolanaEnv(solanaEnv);
}

function toApyBps(supplyApy: number): string {
  return Math.round(supplyApy * 10_000).toString();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveTimescaleReserveForPosition(position: UserYieldPositionRecord) {
  const mainnetEarnTarget = getKaminoUsdcEarnTargetForCluster(
    LoyalCluster.MainnetBeta
  );
  const devnetEarnTarget = getKaminoUsdcEarnTargetForCluster(
    LoyalCluster.Devnet
  );

  if (
    position.currentReserve === devnetEarnTarget.reserve.toBase58() &&
    position.currentMarket === devnetEarnTarget.market.toBase58() &&
    position.currentLiquidityMint === devnetEarnTarget.liquidityMint.toBase58()
  ) {
    return mainnetEarnTarget.reserve.toBase58();
  }

  return position.currentReserve;
}

function serializePosition(
  position: UserYieldPositionRecord,
  currentReserve: TimescaleReserveUpdateRow | null = null,
  holdings: ReturnType<typeof serializeHoldings> = []
) {
  const currentTotalAmountRaw = sumSerializedHoldingsAmountRaw(holdings);
  return {
    currentHolding: {
      amountRaw: position.currentAmountRaw.toString(),
      liquidityMint: position.currentLiquidityMint,
      market: position.currentMarket,
      observedAt: position.currentObservedAt.toISOString(),
      observedSlot: position.currentObservedSlot.toString(),
      provenance: {
        lastHoldingEventId: position.lastHoldingEventId?.toString() ?? null,
        lastRebalanceDecisionId:
          position.lastRebalanceDecisionId?.toString() ?? null,
      },
      reserve: position.currentReserve,
    },
    currentSupplyApyBps: currentReserve
      ? toApyBps(currentReserve.supplyApy)
      : null,
    display: resolveEarnPositionDisplay({
      liquidityMint: position.currentLiquidityMint,
      market: position.currentMarket,
    }),
    id: position.id.toString(),
    initialHolding: {
      liquidityMint: position.initialLiquidityMint,
      market: position.initialMarket,
      reserve: position.initialReserve,
      supplyApyBps: position.initialSupplyApyBps?.toString() ?? null,
    },
    holdings,
    currentTotalAmountRaw: currentTotalAmountRaw.toString(),
    principalAmountRaw: position.principalAmountRaw.toString(),
    status: position.status,
  };
}

function sumSerializedHoldingsAmountRaw(
  holdings: ReturnType<typeof serializeHoldings>
): bigint {
  const total = holdings.reduce((sum, holding) => {
    try {
      return sum + BigInt(holding.amountRaw);
    } catch {
      return sum;
    }
  }, BigInt(0));
  return total > BigInt(0) ? total : BigInt(0);
}

function serializeKaminoHolding(row: CurrentYieldVaultReservePositionRecord) {
  const display = resolveEarnPositionDisplay({
    liquidityMint: row.liquidityMint,
    market: row.market,
  });

  return {
    amountRaw: row.amountRaw.toString(),
    kind: "kamino" as const,
    label: display.label,
    liquidityMint: row.liquidityMint,
    market: row.market,
    marketName: display.marketName,
    observedAt: row.observedAt.toISOString(),
    observedSlot: row.observedSlot.toString(),
    provenance: {
      snapshotId: row.snapshotId.toString(),
      source: "vault_reserve_positions_current",
    },
    reserve: row.reserve,
    supplyApyBps: row.supplyApyBps?.toString() ?? null,
  };
}

function serializeIdleHolding(row: CurrentYieldVaultIdleTokenBalanceRecord) {
  return {
    amountRaw: row.amountRaw.toString(),
    kind: "idle" as const,
    label: "Idle Balance",
    liquidityMint: row.mint,
    market: null,
    marketName: "USDC",
    observedAt: row.observedAt.toISOString(),
    observedSlot: row.observedSlot.toString(),
    provenance: {
      owner: row.owner,
      source: "vault_idle_token_balances_current",
      sourceCommitment: row.sourceCommitment,
      tokenAccount: row.tokenAccount,
    },
    reserve: null,
    supplyApyBps: null,
  };
}

function serializePositionCurrentHoldingAsKamino(
  position: UserYieldPositionRecord
) {
  const display = resolveEarnPositionDisplay({
    liquidityMint: position.currentLiquidityMint,
    market: position.currentMarket,
  });

  return {
    amountRaw: position.currentAmountRaw.toString(),
    kind: "kamino" as const,
    label: display.label,
    liquidityMint: position.currentLiquidityMint,
    market: position.currentMarket,
    marketName: display.marketName,
    observedAt: position.currentObservedAt.toISOString(),
    observedSlot: position.currentObservedSlot.toString(),
    provenance: {
      lastHoldingEventId: position.lastHoldingEventId?.toString() ?? null,
      source: "user_yield_positions",
    },
    reserve: position.currentReserve,
    supplyApyBps: null,
  };
}

function serializeHoldings(args: {
  idleRows: CurrentYieldVaultIdleTokenBalanceRecord[];
  position: UserYieldPositionRecord;
  reserveRows: CurrentYieldVaultReservePositionRecord[];
}) {
  const idleHoldings = args.idleRows
    .filter((row) => row.amountRaw > BigInt(0))
    .map(serializeIdleHolding);
  const kaminoHoldings =
    args.reserveRows.length > 0
      ? args.reserveRows.map(serializeKaminoHolding)
      : idleHoldings.length === 0 && args.position.currentAmountRaw > BigInt(0)
      ? [serializePositionCurrentHoldingAsKamino(args.position)]
      : [];

  return [...kaminoHoldings, ...idleHoldings];
}

async function getCurrentReserveUpdatesByReserveWithRetry(args: {
  reserves: readonly string[];
}): Promise<TimescaleReserveUpdateRow[]> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= CURRENT_RESERVE_LOOKUP_RETRIES; attempt++) {
    try {
      return await getCurrentReserveUpdatesByReserve(args);
    } catch (error) {
      lastError = error;

      if (attempt === CURRENT_RESERVE_LOOKUP_RETRIES) {
        break;
      }

      await delay(CURRENT_RESERVE_LOOKUP_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError;
}

export async function GET(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return NextResponse.json(
      {
        error: {
          code: "unauthenticated",
          message: "No active auth session.",
        },
      },
      { status: 401 }
    );
  }

  const cluster = resolveConfiguredCluster();
  const position = await findReconciledActiveYieldPositionForVault({
    cluster,
    settings: principal.settingsPda,
    vaultIndex: EARN_VAULT_INDEX,
    walletAddress: principal.walletAddress,
  });
  const timescaleReserve = position
    ? resolveTimescaleReserveForPosition(position)
    : null;
  const currentReserveRows = position
    ? await getCurrentReserveUpdatesByReserveWithRetry({
        reserves: [timescaleReserve ?? position.currentReserve],
      }).catch((error) => {
        console.warn(
          "[earn-position] current Timescale reserve lookup failed",
          {
            error,
            currentReserve: position.currentReserve,
            timescaleReserve,
          }
        );
        return [];
      })
    : [];
  const currentReserveByReserve = new Map(
    currentReserveRows.map((row) => [row.reserve, row])
  );
  const [reserveHoldings, idleHoldings] = position
    ? await Promise.all([
        findCurrentNonzeroYieldVaultReservePositions({
          cluster,
          settings: principal.settingsPda,
          vaultIndex: EARN_VAULT_INDEX,
          vaultPubkey: position.vaultPubkey,
          walletAddress: principal.walletAddress,
        }),
        findCurrentYieldVaultIdleTokenBalances({
          cluster,
          settings: principal.settingsPda,
          vaultIndex: EARN_VAULT_INDEX,
          vaultPubkey: position.vaultPubkey,
          walletAddress: principal.walletAddress,
        }),
      ])
    : [[], []];

  return NextResponse.json({
    position: position
      ? serializePosition(
          position,
          currentReserveByReserve.get(
            timescaleReserve ?? position.currentReserve
          ) ?? null,
          serializeHoldings({
            idleRows: idleHoldings,
            position,
            reserveRows: reserveHoldings,
          })
        )
      : null,
  });
}
