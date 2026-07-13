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
import { verifyEarnFullExitZeroBalances } from "@/lib/yield-optimization/earn-full-exit-zero-proof.server";
import { serializeRoutePolicyState } from "@/lib/yield-optimization/earn-state-serializers.server";
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

async function resolveConfirmedSignatureSlot(args: {
  connection: Connection;
  signature: string;
}): Promise<bigint> {
  const { value } = await args.connection.getSignatureStatuses(
    [args.signature],
    { searchTransactionHistory: true }
  );
  const status = value[0] ?? null;
  if (status?.err) {
    throw new Error("Earn cleanup transaction failed on-chain.");
  }
  if (
    typeof status?.slot === "number" &&
    (status.confirmationStatus === "confirmed" ||
      status.confirmationStatus === "finalized")
  ) {
    return BigInt(status.slot);
  }

  const transaction = await args.connection.getTransaction(args.signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (transaction?.meta?.err) {
    throw new Error("Earn cleanup transaction failed on-chain.");
  }
  if (typeof transaction?.slot === "number") {
    return BigInt(transaction.slot);
  }

  throw new Error("Confirmed transaction slot is unavailable.");
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

async function verifyPolicyAccountsClosed(args: {
  accounts: string[];
  connection: Connection;
  minContextSlot: number;
}): Promise<void> {
  const { context, value } =
    await args.connection.getMultipleAccountsInfoAndContext(
      args.accounts.map((account) => new PublicKey(account)),
      { commitment: "confirmed", minContextSlot: args.minContextSlot }
    );
  if (context.slot < args.minContextSlot) {
    throw new Error(
      "Earn policy close proof was observed before the cleanup confirmation slot."
    );
  }
  if (value.some((account) => account !== null)) {
    throw new Error("One or more Earn policy accounts remain open on-chain.");
  }
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
      const proof = await verifyEarnFullExitZeroBalances({
        cluster: persistence.cluster,
        connection,
        minContextSlot,
        policy: serializeRoutePolicyState(
          cleanupState.routePolicy,
          cleanupState.setupPolicy
        ),
        programId: new PublicKey(serverEnv.loyalSmartAccounts.programId),
        settingsPda: new PublicKey(persistence.settings),
      });
      if (proof.status !== "policy_close_required") {
        return jsonError(
          409,
          "full_exit_incomplete",
          "Earn balances remain after cleanup; the position stays active."
        );
      }

      await verifyPolicyAccountsClosed({
        accounts: [
          persistence.policyAccount,
          ...(persistence.setupPolicyAccount
            ? [persistence.setupPolicyAccount]
            : []),
          ...(persistence.autodepositClose?.policyAccount
            ? [persistence.autodepositClose.policyAccount]
            : []),
        ],
        connection,
        minContextSlot,
      });
    } catch (error) {
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
      return jsonError(
        503,
        "full_exit_verification_retryable",
        error instanceof Error
          ? error.message
          : "Earn cleanup could not be verified. Retry confirmation."
      );
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
      503,
      "full_exit_verification_retryable",
      error instanceof Error
        ? error.message
        : "Earn cleanup confirmation could not be verified. Retry confirmation."
    );
  }
}
