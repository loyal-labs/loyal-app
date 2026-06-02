import { NextResponse } from "next/server";
import { KAMINO_MAIN_USDC_RESERVE, LoyalCluster } from "@loyal/actions";
import { resolveSolanaEnv } from "@loyal-labs/solana-rpc";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
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

function serializePosition(position: UserYieldPositionRecord) {
  return {
    ...position,
    createdAt: position.createdAt.toISOString(),
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

  const position = await findActiveYieldPosition({
    cluster: resolveConfiguredCluster(),
    settings: principal.settingsPda,
    targetReserve: KAMINO_MAIN_USDC_RESERVE.toBase58(),
    vaultIndex: EARN_VAULT_INDEX,
    walletAddress: principal.walletAddress,
  });

  return NextResponse.json({
    position: position ? serializePosition(position) : null,
  });
}
