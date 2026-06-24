import { NextResponse } from "next/server";
import { LoyalCluster } from "@loyal-labs/actions";

import { findCurrentUser } from "@/features/chat/server/app-user";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { decodeWalletAddress } from "@/features/identity/server/wallet-auth-signature";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { findEarnAutodepositHistoryEvents } from "@/lib/yield-optimization/earn-autodeposit-repository.server";
import {
  findYieldPositionHistoryEventsForVault,
  syncConfirmedRebalanceHoldingEventsForVault,
} from "@/lib/yield-optimization/yield-deposit-repository.server";
import {
  collapseDuplicateEarnRebalanceTransactions,
  serializeEarnTransactionEvent,
  type SerializedEarnTransaction,
} from "@/app/api/smart-accounts/earn-transactions/formatter";

// Mobile twin of the session `earn-transactions` route. The native Activity >
// Earn tab lists Earn vault history passively, with no signer held (a wallet
// signature would force a Seed Vault biometric prompt on every view), so this
// lookup is keyed by a supplied wallet address rather than a signed request.
// The only write here is an idempotent server-side projection from confirmed
// optimizer decisions into history rows; it never provisions a smart account.
const EARN_VAULT_INDEX = 1;

function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function resolveConfiguredCluster(): LoyalCluster {
  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  return solanaEnv === "devnet"
    ? LoyalCluster.Devnet
    : LoyalCluster.MainnetBeta;
}

// Identical ordering to the session `earn-transactions` route: newest first by
// confirmation time, then slot, then id as a stable tiebreak.
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
  const walletAddress =
    new URL(request.url).searchParams.get("walletAddress")?.trim() ?? "";
  if (!walletAddress) {
    return jsonError(400, "invalid_request", "walletAddress is required.");
  }
  try {
    // Throws a 400 WalletAuthError when the address isn't a valid 32-byte key.
    decodeWalletAddress(walletAddress);
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(400, "invalid_request", "walletAddress is invalid.");
  }

  const emptyResponse = { transactions: [] as SerializedEarnTransaction[] };

  try {
    const user = await findCurrentUser({
      authMethod: "wallet",
      provider: "solana",
      subjectAddress: walletAddress,
      walletAddress,
    });
    if (!user) {
      return NextResponse.json(emptyResponse);
    }

    const account = await findReadyCurrentUserSmartAccount({ userId: user.id });
    if (!account) {
      return NextResponse.json(emptyResponse);
    }

    const cluster = resolveConfiguredCluster();
    await syncConfirmedRebalanceHoldingEventsForVault({
      cluster,
      settings: account.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress,
    });

    const [positionEvents, autodepositEvents] = await Promise.all([
      findYieldPositionHistoryEventsForVault({
        cluster,
        settings: account.settingsPda,
        vaultIndex: EARN_VAULT_INDEX,
        walletAddress,
      }),
      findEarnAutodepositHistoryEvents({
        settings: account.settingsPda,
        vaultIndex: EARN_VAULT_INDEX,
        walletAddress,
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
    console.error("[mobile-earn-transactions] read failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown read error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      502,
      "earn_transactions_failed",
      "Failed to load Earn transactions."
    );
  }
}
