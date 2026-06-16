import { NextResponse } from "next/server";
import { LoyalCluster } from "@loyal-labs/actions";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { findEarnAutodepositHistoryEvents } from "@/lib/yield-optimization/earn-autodeposit-repository.server";
import { findYieldPositionHistoryEventsForVault } from "@/lib/yield-optimization/yield-deposit-repository.server";
import {
  collapseDuplicateEarnRebalanceTransactions,
  serializeEarnTransactionEvent,
  type SerializedEarnTransaction,
} from "./formatter";

const EARN_VAULT_INDEX = 1;

function resolveConfiguredCluster(): LoyalCluster {
  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  return solanaEnv === "devnet"
    ? LoyalCluster.Devnet
    : LoyalCluster.MainnetBeta;
}

function sortEarnTransactions(
  transactions: SerializedEarnTransaction[]
): SerializedEarnTransaction[] {
  return [...transactions].sort((left, right) => {
    const timestampDelta =
      Date.parse(right.sortTimestamp) - Date.parse(left.sortTimestamp);
    if (timestampDelta !== 0) {
      return timestampDelta;
    }

    const leftSlot = BigInt(left.confirmedSlot);
    const rightSlot = BigInt(right.confirmedSlot);
    if (leftSlot !== rightSlot) {
      return leftSlot > rightSlot ? -1 : 1;
    }

    return left.id.localeCompare(right.id);
  });
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

  try {
    const [positionEvents, autodepositEvents] = await Promise.all([
      findYieldPositionHistoryEventsForVault({
        cluster,
        settings: principal.settingsPda,
        vaultIndex: EARN_VAULT_INDEX,
        walletAddress: principal.walletAddress,
      }),
      findEarnAutodepositHistoryEvents({
        settings: principal.settingsPda,
        vaultIndex: EARN_VAULT_INDEX,
        walletAddress: principal.walletAddress,
      }),
    ]);
    const autodepositDepositSignatures = new Set(
      autodepositEvents
        .map((event) => event.depositSignature)
        .filter((signature): signature is string => Boolean(signature))
    );
    const visiblePositionEvents = positionEvents.filter(
      (event) =>
        event.type !== "reconciliation" &&
        !autodepositDepositSignatures.has(event.signature)
    );

    return NextResponse.json({
      transactions: sortEarnTransactions(
        collapseDuplicateEarnRebalanceTransactions(
          [...visiblePositionEvents, ...autodepositEvents].map(
            serializeEarnTransactionEvent
          )
        )
      ),
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
