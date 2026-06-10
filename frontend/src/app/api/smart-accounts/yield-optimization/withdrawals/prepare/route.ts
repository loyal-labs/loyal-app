import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal/actions";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getFrontendSolanaEndpoints } from "@/lib/solana/rpc-endpoints";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import {
  parseEarnWithdrawPrepareRequestBody,
  serializePreparedEarnUsdcWithdraw,
} from "@/lib/yield-optimization/earn-withdraw-prepare-contracts.shared";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import { findActiveYieldRoutePolicy } from "@/lib/yield-optimization/yield-deposit-repository.server";

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

  const { rpcEndpoint, websocketEndpoint } =
    getFrontendSolanaEndpoints(cluster);
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
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let amountRaw: bigint;
  let mode: "partial" | "full";
  try {
    ({ amountRaw, mode } = parseEarnWithdrawPrepareRequestBody(
      await request.json()
    ));
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  const policy = await findActiveYieldRoutePolicy({
    authority: principal.walletAddress,
    cluster,
    settings: principal.settingsPda,
    vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
  });

  if (!policy) {
    console.warn("[earn-withdraw-prepare] missing active Earn policy", {
      cluster,
      settings: principal.settingsPda,
      vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
      walletAddress: principal.walletAddress,
    });
    return jsonError(
      409,
      "missing_earn_policy",
      "Set up the Earn policy before withdrawing USDC."
    );
  }

  try {
    const serverEnv = getServerEnv();
    const policySigner = getDeploymentPolicySignerPublicKey();
    const client = createSmartAccountVaultsClient({
      connection: getConnection(solanaEnv),
      programId: new PublicKey(serverEnv.loyalSmartAccounts.programId),
    });
    const yieldRoutingPolicy = {
      account: new PublicKey(policy.policyAccount),
      seed: policy.policySeed,
    };
    const preparedWithdraw = await client.prepareEarnUsdcWithdraw({
      amountRaw,
      cluster,
      feePayer: new PublicKey(principal.walletAddress),
      mode,
      policySigner,
      settingsPda: new PublicKey(principal.settingsPda),
      walletAddress: new PublicKey(principal.walletAddress),
      yieldRoutingPolicy,
    });

    return NextResponse.json({
      preparedWithdraw: serializePreparedEarnUsdcWithdraw(preparedWithdraw),
    });
  } catch (error) {
    console.error("[earn-withdraw-prepare] prepare failed", {
      amountRaw: amountRaw.toString(),
      cluster,
      errorMessage:
        error instanceof Error ? error.message : "Unknown prepare error.",
      errorName: error instanceof Error ? error.name : typeof error,
      mode,
      policyAccount: policy.policyAccount,
      policySeed: policy.policySeed.toString(),
      settings: principal.settingsPda,
      solanaEnv,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress: principal.walletAddress,
    });
    return jsonError(
      500,
      "prepare_failed",
      error instanceof Error
        ? error.message
        : "Failed to prepare Earn withdrawal."
    );
  }
}
