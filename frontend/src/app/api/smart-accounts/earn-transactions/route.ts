import { NextResponse } from "next/server";
import {
  LoyalCluster,
  getKaminoUsdcEarnTargetForCluster,
} from "@loyal/actions";
import { resolveSolanaEnv } from "@loyal-labs/solana-rpc";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import {
  findYieldPositionHistoryEvents,
} from "@/lib/yield-optimization/yield-deposit-repository.server";
import { serializeEarnTransactionEvent } from "./formatter";

const EARN_VAULT_INDEX = 1;
const SOLANA_ENV_ENV_NAME = "NEXT_PUBLIC_SOLANA_ENV";

function resolveConfiguredCluster(): LoyalCluster {
  const solanaEnv = resolveSolanaEnv(process.env[SOLANA_ENV_ENV_NAME]);
  return solanaEnv === "devnet"
    ? LoyalCluster.Devnet
    : LoyalCluster.MainnetBeta;
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

  try {
    const events = await findYieldPositionHistoryEvents({
      cluster,
      initialReserve: earnTarget.reserve.toBase58(),
      settings: principal.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress: principal.walletAddress,
    });

    return NextResponse.json({
      transactions: events.map(serializeEarnTransactionEvent),
    });
  } catch (error) {
    console.warn("[earn-transactions] failed to load Earn history", error);
    return NextResponse.json(
      {
        error: {
          code: "earn_transactions_unavailable",
          message: "Earn transactions are unavailable.",
        },
      },
      { status: 503 }
    );
  }
}
