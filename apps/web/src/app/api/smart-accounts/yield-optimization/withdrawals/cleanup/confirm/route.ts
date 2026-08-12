import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { recordClosedAutodepositTarget } from "@/lib/yield-optimization/earn-autodeposit-repository.server";
import {
  assertEarnFullExitProven,
  EarnCleanupConfirmError,
  resolveConfirmedSignatureSlot,
} from "@/lib/yield-optimization/earn-cleanup-confirm.server";
import { parseEarnWithdrawCleanupConfirmRequestBody } from "@/lib/yield-optimization/earn-withdraw-cleanup-contracts.shared";
import {
  findEarnCleanupVaultState,
  recordConfirmedEarnCleanup,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

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

function cleanupPolicyMetadataMatches(args: {
  cleanupState: NonNullable<
    Awaited<ReturnType<typeof findEarnCleanupVaultState>>
  >;
  persistence: ReturnType<
    typeof parseEarnWithdrawCleanupConfirmRequestBody
  >["preparedCleanup"]["persistence"];
}): boolean {
  const { cleanupState, persistence } = args;
  const setupPolicy = cleanupState.setupPolicy;

  return (
    cleanupState.routePolicy.policyAccount === persistence.policyAccount &&
    cleanupState.routePolicy.policySeed.toString() === persistence.policySeed &&
    (setupPolicy?.policyAccount ?? null) ===
      (persistence.setupPolicyAccount ?? null) &&
    (setupPolicy?.policySeed.toString() ?? null) ===
      (persistence.setupPolicySeed ?? null)
  );
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
  if (
    persistence.cluster !== resolveLoyalClusterForSolanaEnv(solanaEnv)
  ) {
    return jsonError(
      400,
      "cluster_mismatch",
      "Prepared cleanup cluster does not match the configured Solana environment."
    );
  }
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

    const cleanupState = await findEarnCleanupVaultState({
      authority: persistence.walletAddress,
      includeInactive: true,
      settings: persistence.settings,
      vaultIndex: persistence.vaultIndex,
      vaultPubkey: persistence.vaultPubkey,
    });
    if (!cleanupState) {
      return jsonError(
        409,
        "missing_earn_policy",
        "Earn policy state is unavailable for cleanup confirmation."
      );
    }
    if (!cleanupPolicyMetadataMatches({ cleanupState, persistence })) {
      return jsonError(
        409,
        "cleanup_policy_mismatch",
        "Prepared cleanup policy metadata does not match the persisted Earn policy."
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
    }

    const minContextSlot = Number(confirmedSlot);
    if (!Number.isSafeInteger(minContextSlot) || minContextSlot < 0) {
      return jsonError(
        400,
        "invalid_confirmed_slot",
        "Confirmed Earn cleanup slot is outside the supported range."
      );
    }

    try {
      const serverEnv = getServerEnv();
      await assertEarnFullExitProven({
        cleanupState,
        cluster: persistence.cluster,
        connection,
        minContextSlot,
        policyAccounts: [
          persistence.policyAccount,
          ...(persistence.setupPolicyAccount
            ? [persistence.setupPolicyAccount]
            : []),
          ...(persistence.autodepositClose?.policyAccount
            ? [persistence.autodepositClose.policyAccount]
            : []),
        ],
        programId: new PublicKey(serverEnv.loyalSmartAccounts.programId),
        settingsPda: new PublicKey(persistence.settings),
      });
    } catch (error) {
      if (!(error instanceof EarnCleanupConfirmError)) {
        throw error;
      }
      console.error("[earn-withdraw-cleanup-confirm] proof retryable", {
        cleanupSignature: body.cleanupSignature,
        errorMessage:
          error instanceof Error ? error.message : "Unknown proof error.",
        errorName: error instanceof Error ? error.name : typeof error,
        minContextSlot,
        settings: principal.settingsPda,
        stack: error instanceof Error ? error.stack : undefined,
        walletAddress: principal.walletAddress,
      });
      return jsonError(error.status, error.code, error.message);
    }

    if (
      persistence.autodepositClose &&
      body.autodepositCloseSignature &&
      body.autodepositCloseConfirmedSlot
    ) {
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

    console.info("[earn-withdraw-cleanup-confirm] full exit closed", {
      cleanupSignature: body.cleanupSignature,
      confirmedSlot: confirmedSlot.toString(),
      settings: persistence.settings,
      status: "full_exit_closed",
      vaultIndex: persistence.vaultIndex,
      walletAddress: persistence.walletAddress,
    });
    return NextResponse.json({ ok: true, status: "full_exit_closed" });
  } catch (error) {
    if (error instanceof EarnCleanupConfirmError) {
      return jsonError(error.status, error.code, error.message);
    }
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
        : "Earn cleanup confirmation failed."
    );
  }
}
