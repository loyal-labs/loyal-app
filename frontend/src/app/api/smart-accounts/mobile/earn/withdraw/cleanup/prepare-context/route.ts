import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
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
import { fetchEarnRpcHoldingsSnapshot } from "@/lib/yield-optimization/earn-rpc-holdings.client";
import { serializeRoutePolicyState } from "@/lib/yield-optimization/earn-state-serializers.server";
import { findEarnCleanupVaultState } from "@/lib/yield-optimization/yield-deposit-repository.server";

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

function hasPositiveAmount(amountRaw: string): boolean {
  try {
    return BigInt(amountRaw) > BigInt(0);
  } catch {
    return true;
  }
}

// The device pins these reads to its withdrawal confirmation slot; this
// route's RPC node can be a beat behind right after confirmation, which
// surfaces as JSON-RPC -32016 rather than stale data. That lag clears within
// a slot or two, so retry briefly instead of failing the cleanup phase of an
// already-landed withdrawal (the invisible-deposits incident came from
// unretried post-confirm reads like this).
const SLOT_LAG_ATTEMPTS = 3;
const SLOT_LAG_RETRY_DELAY_MS = 500;

function isMinContextSlotError(error: unknown): boolean {
  if (
    error !== null &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === -32016
  ) {
    return true;
  }
  return (
    error instanceof Error &&
    /minimum context slot has not been reached/i.test(error.message)
  );
}

async function readWithSlotLagRetry<T>(read: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < SLOT_LAG_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, SLOT_LAG_RETRY_DELAY_MS)
      );
    }
    try {
      return await read();
    } catch (error) {
      if (!isMinContextSlotError(error)) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError;
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

  let minContextSlot: number;
  try {
    minContextSlot = parseMinContextSlot(body);
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
      includeInactive: true,
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
    const client = createSmartAccountVaultsClient({ connection, programId });
    const [holdingsSnapshot, vaultSnapshot] = await readWithSlotLagRetry(() =>
      Promise.all([
        fetchEarnRpcHoldingsSnapshot({
          cluster,
          connection,
          minContextSlot,
          policy: serializeRoutePolicyState(
            cleanupState.routePolicy,
            cleanupState.setupPolicy
          ),
          programId,
          settingsPda: settingsPdaKey,
        }),
        client.fetchEarnVaultRefundSnapshot({
          cluster,
          minContextSlot,
          settingsPda: settingsPdaKey,
        }),
      ])
    );
    if (
      holdingsSnapshot.holdings.some(
        (holding) =>
          holding.kind === "kamino" && hasPositiveAmount(holding.amountRaw)
      )
    ) {
      return jsonError(
        409,
        "active_earn_sources_remaining",
        "The full Earn withdrawal must confirm before cleanup."
      );
    }

    const vaultUsdcAta = vaultSnapshot.vaultUsdcAta;
    if (
      vaultSnapshot.tokenAccounts.some(
        (tokenAccount) =>
          !tokenAccount.address.equals(vaultUsdcAta) &&
          tokenAccount.amountRaw > BigInt(0)
      )
    ) {
      return jsonError(
        409,
        "active_earn_sources_remaining",
        "The Earn vault still holds a non-cleanup token balance."
      );
    }

    const idleAmountRaw =
      vaultSnapshot.tokenAccounts.find((tokenAccount) =>
        tokenAccount.address.equals(vaultUsdcAta)
      )?.amountRaw ?? BigInt(0);
    const closeVaultCollateralAtas = vaultSnapshot.tokenAccounts
      .filter(
        (tokenAccount) =>
          !tokenAccount.address.equals(vaultUsdcAta) &&
          tokenAccount.amountRaw === BigInt(0)
      )
      .map((tokenAccount) => tokenAccount.address.toBase58());

    return NextResponse.json({
      cleanupInput: {
        closeVaultCollateralAtas,
        idleAmountRaw: idleAmountRaw.toString(),
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
      minContextSlot,
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
