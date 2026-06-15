import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getFrontendSolanaEndpoints } from "@/lib/solana/rpc-endpoints";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import {
  parseEarnDepositPrepareRequestBody,
  serializePreparedEarnUsdcDeposit,
} from "@/lib/yield-optimization/earn-deposit-prepare-contracts.shared";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import { findBestSafeUsdcEarnReserveTarget } from "@/lib/yield-optimization/earn-reserve-target.server";
import {
  findActiveYieldRoutePolicy,
  findReconciledActiveYieldPositionForVault,
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
  try {
    ({ amountRaw } = parseEarnDepositPrepareRequestBody(await request.json()));
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  let policy: Awaited<ReturnType<typeof findActiveYieldRoutePolicy>> = null;

  try {
    const serverEnv = getServerEnv();
    const programId = new PublicKey(serverEnv.loyalSmartAccounts.programId);
    const settingsPda = new PublicKey(principal.settingsPda);
    const [earnVaultPda] = pda.getSmartAccountPda({
      accountIndex: EARN_DEPOSIT_VAULT_INDEX,
      programId,
      settingsPda,
    });
    const [policyResult, activePosition] = await Promise.all([
      findActiveYieldRoutePolicy({
        authority: principal.walletAddress,
        cluster,
        settings: principal.settingsPda,
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        vaultPubkey: earnVaultPda.toBase58(),
      }),
      findReconciledActiveYieldPositionForVault({
        cluster,
        settings: principal.settingsPda,
        vaultIndex: EARN_DEPOSIT_VAULT_INDEX,
        walletAddress: principal.walletAddress,
      }),
    ]);
    policy = policyResult;
    const policySigner = getDeploymentPolicySignerPublicKey();
    const client = createSmartAccountVaultsClient({
      connection: getConnection(solanaEnv),
      programId,
    });
    const yieldRoutingPolicy = policy
      ? {
          account: new PublicKey(policy.policyAccount),
          seed: policy.policySeed,
        }
      : undefined;
    const target =
      policy && activePosition
        ? await findBestSafeUsdcEarnReserveTarget(cluster)
        : null;
    if (policy && activePosition && !target) {
      return jsonError(
        409,
        "no_eligible_earn_reserve",
        "No fresh Safe USDC reserve candidate is available for this top-up."
      );
    }
    const preparedDeposit = await client.prepareEarnUsdcDeposit({
      amountRaw,
      cluster,
      feePayer: new PublicKey(principal.walletAddress),
      initializeYieldRoutingPolicy: !policy,
      policySigner,
      settingsPda: new PublicKey(principal.settingsPda),
      walletAddress: new PublicKey(principal.walletAddress),
      ...(target ? { target } : {}),
      ...(yieldRoutingPolicy ? { yieldRoutingPolicy } : {}),
    });
    return NextResponse.json({
      preparedDeposit: serializePreparedEarnUsdcDeposit(preparedDeposit),
    });
  } catch (error) {
    console.error("[earn-deposit-prepare] prepare failed", {
      amountRaw: amountRaw.toString(),
      cluster,
      errorMessage:
        error instanceof Error ? error.message : "Unknown prepare error.",
      errorName: error instanceof Error ? error.name : typeof error,
      policyAccount: policy?.policyAccount ?? null,
      policySeed: policy?.policySeed.toString() ?? null,
      settings: principal.settingsPda,
      solanaEnv,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress: principal.walletAddress,
    });
    return jsonError(
      500,
      "prepare_failed",
      error instanceof Error ? error.message : "Failed to prepare Earn deposit."
    );
  }
}
