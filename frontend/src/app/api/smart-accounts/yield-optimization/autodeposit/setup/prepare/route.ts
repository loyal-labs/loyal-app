import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { createSmartAccountVaultsClient } from "@loyal-labs/smart-account-vaults";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import {
  parseEarnAutodepositSetupPrepareRequestBody,
  serializePreparedEarnUsdcAutodepositSetup,
} from "@/lib/yield-optimization/earn-autodeposit-prepare-contracts.shared";

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

export async function POST(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  let parsed: ReturnType<typeof parseEarnAutodepositSetupPrepareRequestBody>;
  try {
    parsed = parseEarnAutodepositSetupPrepareRequestBody(await request.json());
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
    const client = createSmartAccountVaultsClient({
      connection: getConnection(solanaEnv),
      programId: new PublicKey(serverEnv.loyalSmartAccounts.programId),
    });
    const prepareArgs = {
      amountRaw: parsed.amountRaw,
      cluster,
      feePayer: new PublicKey(principal.walletAddress),
      nonce: parsed.nonce,
      policySigner,
      policySeed: parsed.policySeed,
      settingsPda: new PublicKey(principal.settingsPda),
      signer: new PublicKey(principal.walletAddress),
      walletAddress: new PublicKey(principal.walletAddress),
    };
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
    console.error("[earn-autodeposit-setup-prepare] prepare failed", {
      amountRaw: parsed.amountRaw.toString(),
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
      error instanceof Error
        ? error.message
        : "Failed to prepare Earn autodeposit setup."
    );
  }
}
