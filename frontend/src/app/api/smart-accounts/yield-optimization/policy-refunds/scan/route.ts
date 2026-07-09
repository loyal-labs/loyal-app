import { NextResponse } from "next/server";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { scanEarnPolicyRefunds } from "@/lib/yield-optimization/earn-policy-refund.server";

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
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  try {
    const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
    const response = await scanEarnPolicyRefunds({
      connection: getConnection(solanaEnv),
      programId: new PublicKey(getServerEnv().loyalSmartAccounts.programId),
      settingsPda: principal.settingsPda,
      solanaEnv,
      walletAddress: principal.walletAddress,
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error("[earn-policy-refunds-scan] failed", {
      errorMessage: error instanceof Error ? error.message : String(error),
      settings: principal.settingsPda,
      walletAddress: principal.walletAddress,
    });
    return jsonError(
      500,
      "scan_failed",
      error instanceof Error ? error.message : "Failed to scan policies."
    );
  }
}
