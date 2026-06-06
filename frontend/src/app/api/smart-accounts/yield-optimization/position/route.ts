import { NextResponse } from "next/server";
import {
  LoyalCluster,
  getKaminoUsdcEarnTargetForCluster,
} from "@loyal/actions";
import { resolveSolanaEnv } from "@loyal-labs/solana-rpc";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import {
  getCurrentReserveUpdatesByReserve,
  type TimescaleReserveUpdateRow,
} from "@/lib/kamino/timescale-reserve-client.server";
import { resolveEarnPositionDisplay } from "@/lib/yield-optimization/earn-position-display";
import {
  findActiveYieldPosition,
  type UserYieldPositionRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

const EARN_VAULT_INDEX = 1;
const SOLANA_ENV_ENV_NAME = "NEXT_PUBLIC_SOLANA_ENV";

function resolveConfiguredCluster(): LoyalCluster {
  const solanaEnv = resolveSolanaEnv(process.env[SOLANA_ENV_ENV_NAME]);
  return solanaEnv === "devnet"
    ? LoyalCluster.Devnet
    : LoyalCluster.MainnetBeta;
}

function toApyBps(supplyApy: number): string {
  return Math.round(supplyApy * 10_000).toString();
}

function resolveTimescaleReserveForPosition(position: UserYieldPositionRecord) {
  const mainnetEarnTarget = getKaminoUsdcEarnTargetForCluster(
    LoyalCluster.MainnetBeta
  );
  const devnetEarnTarget = getKaminoUsdcEarnTargetForCluster(
    LoyalCluster.Devnet
  );

  if (
    position.targetReserve === devnetEarnTarget.reserve.toBase58() &&
    position.market === devnetEarnTarget.market.toBase58() &&
    position.liquidityMint === devnetEarnTarget.liquidityMint.toBase58()
  ) {
    return mainnetEarnTarget.reserve.toBase58();
  }

  return position.targetReserve;
}

function serializePosition(
  position: UserYieldPositionRecord,
  currentReserve: TimescaleReserveUpdateRow | null = null
) {
  return {
    ...position,
    createdAt: position.createdAt.toISOString(),
    currentSupplyApyBps: currentReserve
      ? toApyBps(currentReserve.supplyApy)
      : null,
    display: resolveEarnPositionDisplay({
      liquidityMint: position.liquidityMint,
      market: position.market,
    }),
    firstDepositSignature: position.firstDepositSignature,
    id: position.id.toString(),
    lastConfirmedSlot: position.lastConfirmedSlot.toString(),
    policyId: position.policyId.toString(),
    policySeed: position.policySeed.toString(),
    principalAmountRaw: position.principalAmountRaw.toString(),
    targetSupplyApyBps: position.targetSupplyApyBps?.toString() ?? null,
    updatedAt: position.updatedAt.toISOString(),
  };
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
  const earnTarget = getKaminoUsdcEarnTargetForCluster(cluster);
  const position = await findActiveYieldPosition({
    cluster,
    settings: principal.settingsPda,
    targetReserve: earnTarget.reserve.toBase58(),
    vaultIndex: EARN_VAULT_INDEX,
    walletAddress: principal.walletAddress,
  });
  const timescaleReserve = position
    ? resolveTimescaleReserveForPosition(position)
    : null;
  const currentReserveRows = position
    ? await getCurrentReserveUpdatesByReserve({
        reserves: [timescaleReserve ?? position.targetReserve],
      }).catch((error) => {
        console.warn("[earn-position] current Timescale reserve lookup failed", {
          error,
          targetReserve: position.targetReserve,
          timescaleReserve,
        });
        return [];
      })
    : [];
  const currentReserveByReserve = new Map(
    currentReserveRows.map((row) => [row.reserve, row])
  );

  return NextResponse.json({
    position: position
      ? serializePosition(
          position,
          currentReserveByReserve.get(timescaleReserve ?? position.targetReserve) ??
            null
        )
      : null,
  });
}
