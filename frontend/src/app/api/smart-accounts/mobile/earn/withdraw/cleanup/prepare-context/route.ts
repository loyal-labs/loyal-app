import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { getOrCreateCurrentUser } from "@/features/chat/server/app-user";
import { authenticateMobileWalletRequest } from "@/features/identity/server/mobile-wallet-auth";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import { verifyEarnFullExitZeroBalances } from "@/lib/yield-optimization/earn-full-exit-zero-proof.server";
import { serializeRoutePolicyState } from "@/lib/yield-optimization/earn-state-serializers.server";
import {
  findEarnCleanupVaultState,
  findLatestFullYieldWithdrawalForVault,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

// Phase two of a full mobile withdrawal. The backend only resolves a fresh,
// post-withdraw chain context; the device builds and signs the cleanup with
// prepareEarnUsdcCleanup, matching the other on-device Earn prepare flows.
const EARN_DEPOSIT_VAULT_INDEX = 1;

const connectionCache = new Map<SolanaEnv, Connection>();

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function getConfiguredSolanaEnv(): SolanaEnv {
  return resolveLoyalWebSolanaEnvFromEnv(process.env);
}

function getConnection(cluster: SolanaEnv): Connection {
  const cached = connectionCache.get(cluster);
  if (cached) {
    return cached;
  }

  const { rpcEndpoint, websocketEndpoint } = getServerSolanaEndpoints(cluster);
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
  connectionCache.set(cluster, connection);
  return connection;
}

function parseMinContextSlot(body: unknown): number {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body.");
  }
  const value = (body as { minContextSlot?: unknown }).minContextSlot;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("minContextSlot must be a non-negative integer string.");
  }
  const slot = Number(value);
  if (!Number.isSafeInteger(slot)) {
    throw new Error("minContextSlot is outside the supported range.");
  }
  return slot;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_request", "Invalid request body.");
  }

  let walletAddress: string;
  try {
    ({ walletAddress } = await authenticateMobileWalletRequest({
      body,
      purpose: "earn-withdraw-prepare",
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
  }

  let requestedMinContextSlot: number;
  try {
    requestedMinContextSlot = parseMinContextSlot(body);
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  let settingsPda: string;
  try {
    const user = await getOrCreateCurrentUser({
      provider: "solana",
      authMethod: "wallet",
      subjectAddress: walletAddress,
      walletAddress,
    });
    const existing = await findReadyCurrentUserSmartAccount({
      userId: user.id,
      walletAddress,
    });
    if (!existing) {
      return jsonError(
        409,
        "smart_account_not_ready",
        "No provisioned smart account for this wallet."
      );
    }
    settingsPda = existing.settingsPda;
  } catch (error) {
    console.error("[mobile-earn-withdraw-cleanup-context] resolve failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown resolve error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      502,
      "resolve_failed",
      "Failed to resolve the smart account for this wallet."
    );
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);

  try {
    const serverEnv = getServerEnv();
    const programId = new PublicKey(serverEnv.loyalSmartAccounts.programId);
    const settingsPdaKey = new PublicKey(settingsPda);
    const [earnVaultPda] = pda.getSmartAccountPda({
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
      programId,
      settingsPda: settingsPdaKey,
    });
    const cleanupState = await findEarnCleanupVaultState({
      authority: walletAddress,
      settings: settingsPda,
      vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
      vaultPubkey: earnVaultPda.toBase58(),
    });
    if (!cleanupState) {
      return jsonError(
        409,
        "missing_earn_policy",
        "No Earn accounts were found to close."
      );
    }

    const connection = getConnection(solanaEnv);
    const latestFullWithdrawal = await findLatestFullYieldWithdrawalForVault({
      settings: settingsPda,
      vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
      vaultPubkey: earnVaultPda.toBase58(),
      walletAddress,
    });
    if (!latestFullWithdrawal) {
      return jsonError(
        409,
        "missing_full_withdrawal",
        "A confirmed full withdrawal is required before closing Earn accounts."
      );
    }
    const serverMinContextSlot = Number(latestFullWithdrawal.confirmedSlot);
    if (!Number.isSafeInteger(serverMinContextSlot) || serverMinContextSlot < 0) {
      return jsonError(
        409,
        "missing_full_exit_verification_anchor",
        "The confirmed full withdrawal slot is outside the supported range."
      );
    }
    const minContextSlot = Math.max(
      requestedMinContextSlot,
      serverMinContextSlot
    );

    let proof: Awaited<ReturnType<typeof verifyEarnFullExitZeroBalances>>;
    try {
      proof = await verifyEarnFullExitZeroBalances({
        cluster,
        connection,
        minContextSlot,
        policy: serializeRoutePolicyState(
          cleanupState.routePolicy,
          cleanupState.setupPolicy
        ),
        programId,
        settingsPda: settingsPdaKey,
      });
    } catch (error) {
      console.error(
        "[mobile-earn-withdraw-cleanup-context] zero proof retryable",
        {
          errorMessage:
            error instanceof Error ? error.message : "Unknown proof error.",
          errorName: error instanceof Error ? error.name : typeof error,
          minContextSlot,
          settings: settingsPda,
          stack: error instanceof Error ? error.stack : undefined,
          walletAddress,
        }
      );
      return jsonError(
        503,
        "full_exit_verification_retryable",
        error instanceof Error
          ? error.message
          : "Earn balances could not be verified. Retry cleanup."
      );
    }
    if (proof.status !== "policy_close_required") {
      return jsonError(
        409,
        "full_exit_incomplete",
        "Earn balances remain above the full-exit dust tolerance."
      );
    }

    return NextResponse.json({
      cleanupInput: {
        closeVaultCollateralAtas: proof.closeableTokenAccounts,
        idleAmountRaw: proof.idleAmountRaw,
        policySigner: getDeploymentPolicySignerPublicKey().toBase58(),
        yieldRoutingPolicy: {
          account: cleanupState.routePolicy.policyAccount,
          seed: cleanupState.routePolicy.policySeed.toString(),
          setupPolicy: cleanupState.setupPolicy
            ? {
                account: cleanupState.setupPolicy.policyAccount,
                seed: cleanupState.setupPolicy.policySeed.toString(),
              }
            : null,
        },
      },
      cluster,
      programId: serverEnv.loyalSmartAccounts.programId,
      settingsPda,
    });
  } catch (error) {
    console.error("[mobile-earn-withdraw-cleanup-context] context failed", {
      cluster,
      errorMessage:
        error instanceof Error ? error.message : "Unknown context error.",
      errorName: error instanceof Error ? error.name : typeof error,
      requestedMinContextSlot,
      settings: settingsPda,
      solanaEnv,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      500,
      "context_failed",
      error instanceof Error
        ? error.message
        : "Failed to resolve Earn cleanup context."
    );
  }
}
