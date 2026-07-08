import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaConnection } from "@/lib/solana/rpc-connection.server";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import {
  parseEarnPolicyPrepareRequestBody,
  serializePreparedEarnUsdcYieldRoutingPolicy,
} from "@/lib/yield-optimization/earn-policy-prepare-contracts.shared";
import { getEarnPolicySponsorPublicKey } from "@/lib/yield-optimization/earn-policy-sponsored-transaction.server";

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

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let sponsored: boolean;
  try {
    const parsed = parseEarnPolicyPrepareRequestBody(
      await request.json().catch(() => ({}))
    );
    sponsored = parsed.sponsored ?? false;
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  const solanaEnv = getConfiguredSolanaEnv();
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);

  try {
    const serverEnv = getServerEnv();
    const policySigner = getDeploymentPolicySignerPublicKey();
    const feePayer = sponsored
      ? getEarnPolicySponsorPublicKey()
      : new PublicKey(principal.walletAddress);
    const client = createSmartAccountVaultsClient({
      connection: getServerSolanaConnection(solanaEnv),
      programId: new PublicKey(serverEnv.loyalSmartAccounts.programId),
    });
    const preparedPolicy = await client.prepareEarnUsdcYieldRoutingPolicy({
      cluster,
      feePayer,
      ...(sponsored ? { rentPayer: feePayer } : {}),
      settingsPda: new PublicKey(principal.settingsPda),
      signer: policySigner,
      walletAddress: new PublicKey(principal.walletAddress),
    });

    return NextResponse.json({
      preparedPolicy:
        serializePreparedEarnUsdcYieldRoutingPolicy(preparedPolicy),
    });
  } catch (error) {
    console.error("[earn-policy-prepare] prepare failed", {
      cluster,
      errorMessage:
        error instanceof Error ? error.message : "Unknown prepare error.",
      errorName: error instanceof Error ? error.name : typeof error,
      settings: principal.settingsPda,
      solanaEnv,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress: principal.walletAddress,
    });
    return jsonError(
      500,
      "prepare_failed",
      error instanceof Error ? error.message : "Failed to prepare Earn policy."
    );
  }
}
