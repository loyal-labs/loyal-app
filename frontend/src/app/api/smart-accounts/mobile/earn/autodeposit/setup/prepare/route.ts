import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
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
import {
  parseEarnAutodepositSetupPrepareRequestBody,
  serializePreparedEarnUsdcAutodepositSetup,
} from "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared";
import { findCurrentEarnAutodepositState } from "@/lib/yield-optimization/earn-autodeposit-repository.server";

// Mobile twin of `yield-optimization/autodeposit/setup/prepare`. Wallet-sig auth
// + self-resolved smart account; the SDK returns the next setup stage's prepared
// op (initialize_subscription_authority -> create_policy ->
// create_recurring_delegation) for the device to sign. The orchestrator threads
// the returned nonce/policySeed back into subsequent stages. Keep in sync with
// the session route.
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
      purpose: "earn-autodeposit-setup-prepare",
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
  }

  let parsed: ReturnType<typeof parseEarnAutodepositSetupPrepareRequestBody>;
  try {
    parsed = parseEarnAutodepositSetupPrepareRequestBody(body);
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
    console.error("[mobile-earn-autodeposit-setup-prepare] resolve failed", {
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
    const policySigner = getDeploymentPolicySignerPublicKey();
    const client = createSmartAccountVaultsClient({
      connection: getConnection(solanaEnv),
      programId: new PublicKey(serverEnv.loyalSmartAccounts.programId),
    });
    // Resume a half-finished setup. Reusing the recorded seed + nonce makes the
    // SDK's chain-driven stage machine return only the missing stage for the
    // SAME policy/delegation pair.
    let policySeed = parsed.policySeed;
    let nonce = parsed.nonce;
    let periodLengthSeconds = parsed.periodLengthSeconds;
    let startTimestamp = parsed.startTimestamp;
    let expiryTimestamp = parsed.expiryTimestamp;
    if (policySeed === undefined) {
      const current = await findCurrentEarnAutodepositState({
        settings: settingsPda,
        vaultIndex: 1,
        walletAddress,
      });
      const target = current?.target;
      // An already-active Autodeposit must be deleted, not set up over: a
      // fresh prepare mints a second policy seed and stands up a duplicate
      // on-chain policy that delete/withdraw flows then trip over. A stale
      // "active" row heals through the `/state` reconcile before retry.
      if (target?.lifecycleStatus === "active") {
        return jsonError(
          409,
          "autodeposit_already_active",
          "An Autodeposit is already active for this wallet. Delete it before creating a new one."
        );
      }
      if (
        (target?.lifecycleStatus === "pending_delegation" ||
          target?.lifecycleStatus === "pending_policy") &&
        target.recurringDelegationNonce !== null
      ) {
        policySeed = target.policySeed;
        nonce = target.recurringDelegationNonce;
        periodLengthSeconds =
          target.periodLengthSeconds ?? periodLengthSeconds;
        startTimestamp = target.startTimestamp ?? startTimestamp;
        expiryTimestamp =
          target.recurringDelegationExpiryTimestamp ?? expiryTimestamp;
      }
    }
    const prepareArgs = {
      amountRaw: parsed.amountRaw,
      cluster,
      expiryTimestamp,
      feePayer: new PublicKey(walletAddress),
      minimumDelegatorBalanceRaw: parsed.walletBalanceFloorRaw,
      nonce,
      periodLengthSeconds,
      policySigner,
      policySeed,
      settingsPda: new PublicKey(settingsPda),
      signer: new PublicKey(walletAddress),
      startTimestamp,
      walletAddress: new PublicKey(walletAddress),
    };
    // `includeBatch` mirrors the web route: the create_policy stage also
    // returns the create_recurring_delegation stage prepared ahead, so the
    // device can sign both in one wallet prompt and send them in order.
    const preparedSetups = parsed.includeBatch
      ? await client.prepareEarnUsdcAutodepositSetupBatch(prepareArgs)
      : [await client.prepareEarnUsdcAutodepositSetup(prepareArgs)];
    const preparedSetup = preparedSetups[0];
    if (!preparedSetup) {
      throw new Error("Failed to prepare Earn autodeposit setup.");
    }

    return NextResponse.json({
      nextPreparedSetup: preparedSetups[1]
        ? serializePreparedEarnUsdcAutodepositSetup(preparedSetups[1])
        : null,
      preparedSetup: serializePreparedEarnUsdcAutodepositSetup(preparedSetup),
    });
  } catch (error) {
    console.error("[mobile-earn-autodeposit-setup-prepare] prepare failed", {
      amountRaw: parsed.amountRaw.toString(),
      cluster,
      errorMessage:
        error instanceof Error ? error.message : "Unknown prepare error.",
      errorName: error instanceof Error ? error.name : typeof error,
      settings: settingsPda,
      solanaEnv,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      500,
      "prepare_failed",
      error instanceof Error
        ? error.message
        : "Failed to prepare Earn autodeposit setup."
    );
  }
}
