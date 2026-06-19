import { NextResponse } from "next/server";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { recordClosedAutodepositTarget } from "@/lib/yield-optimization/earn-autodeposit-repository.server";
import { parseEarnWithdrawCleanupConfirmRequestBody } from "@/lib/yield-optimization/earn-withdraw-cleanup-contracts.shared";
import { recordConfirmedEarnCleanup } from "@/lib/yield-optimization/yield-deposit-repository.server";

const EARN_DEPOSIT_VAULT_INDEX = 1;

const connectionCache = new Map<SolanaEnv, Connection>();

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function getConnection(cluster: SolanaEnv): Connection {
  const cached = connectionCache.get(cluster);
  if (cached) {
    return cached;
  }

  const { rpcEndpoint, websocketEndpoint } =
    getServerSolanaEndpoints(cluster);
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
  connectionCache.set(cluster, connection);
  return connection;
}

async function resolveConfirmedSignatureSlot(args: {
  connection: Connection;
  signature: string;
}): Promise<bigint> {
  const { value } = await args.connection.getSignatureStatuses(
    [args.signature],
    { searchTransactionHistory: true }
  );
  const status = value[0] ?? null;
  if (typeof status?.slot === "number") {
    return BigInt(status.slot);
  }

  const transaction = await args.connection.getTransaction(args.signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (typeof transaction?.slot === "number") {
    return BigInt(transaction.slot);
  }

  throw new Error("Confirmed transaction slot is unavailable.");
}

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let body: ReturnType<typeof parseEarnWithdrawCleanupConfirmRequestBody>;
  try {
    body = parseEarnWithdrawCleanupConfirmRequestBody(await request.json());
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  const persistence = body.preparedCleanup.persistence;
  if (
    persistence.walletAddress !== principal.walletAddress ||
    persistence.settings !== principal.settingsPda ||
    persistence.vaultIndex !== EARN_DEPOSIT_VAULT_INDEX
  ) {
    return jsonError(
      403,
      "cleanup_owner_mismatch",
      "Prepared cleanup does not belong to the authenticated wallet."
    );
  }

  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  const connection = getConnection(solanaEnv);

  try {
    const confirmedSlot = await resolveConfirmedSignatureSlot({
      connection,
      signature: body.cleanupSignature,
    });
    if (BigInt(body.confirmedSlot) !== confirmedSlot) {
      return jsonError(
        400,
        "slot_mismatch",
        "Confirmed Earn cleanup slot does not match the transaction status."
      );
    }

    if (
      persistence.autodepositClose &&
      (!body.autodepositCloseSignature || !body.autodepositCloseConfirmedSlot)
    ) {
      return jsonError(
        400,
        "missing_autodeposit_close",
        "Autodeposit close confirmation is required before Earn cleanup."
      );
    }

    if (
      persistence.autodepositClose &&
      body.autodepositCloseSignature &&
      body.autodepositCloseConfirmedSlot
    ) {
      const autodepositCloseSlot = await resolveConfirmedSignatureSlot({
        connection,
        signature: body.autodepositCloseSignature,
      });
      if (BigInt(body.autodepositCloseConfirmedSlot) !== autodepositCloseSlot) {
        return jsonError(
          400,
          "autodeposit_close_slot_mismatch",
          "Confirmed Autodeposit close slot does not match the transaction status."
        );
      }

      await recordClosedAutodepositTarget({
        cluster: persistence.cluster,
        closeSignature: body.autodepositCloseSignature,
        confirmedSlot: BigInt(body.autodepositCloseConfirmedSlot),
        delegatedSigner: persistence.autodepositClose.delegatedSigner,
        policyAccount: persistence.autodepositClose.policyAccount,
        recurringDelegation: persistence.autodepositClose.recurringDelegation,
        settings: persistence.settings,
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        vaultPubkey: persistence.vaultPubkey,
        walletAddress: persistence.walletAddress,
      });
    }

    await recordConfirmedEarnCleanup({
      cleanupSignature: body.cleanupSignature,
      cluster: persistence.cluster,
      confirmedSlot,
      settings: persistence.settings,
      vaultIndex: persistence.vaultIndex,
      vaultPubkey: persistence.vaultPubkey,
      walletAddress: persistence.walletAddress,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[earn-withdraw-cleanup-confirm] failed", {
      cleanupSignature: body.cleanupSignature,
      errorMessage:
        error instanceof Error ? error.message : "Unknown cleanup error.",
      errorName: error instanceof Error ? error.name : typeof error,
      settings: principal.settingsPda,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress: principal.walletAddress,
    });
    return jsonError(
      500,
      "confirm_failed",
      error instanceof Error
        ? error.message
        : "Failed to record confirmed Earn cleanup."
    );
  }
}
