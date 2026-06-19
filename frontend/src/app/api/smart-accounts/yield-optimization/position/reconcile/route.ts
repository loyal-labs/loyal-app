import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { reconcileEarnVaultPosition } from "@/lib/yield-optimization/earn-position-reconciliation.server";

const EARN_VAULT_INDEX = 1;
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

  try {
    const body = (await request.json().catch(() => ({}))) as {
      force?: unknown;
    };
    const solanaEnv = getConfiguredSolanaEnv();
    const serverEnv = getServerEnv();
    const programId = new PublicKey(serverEnv.loyalSmartAccounts.programId);
    const settingsPda = new PublicKey(principal.settingsPda);
    const [earnVaultPda] = pda.getSmartAccountPda({
      accountIndex: EARN_VAULT_INDEX,
      programId,
      settingsPda,
    });
    const result = await reconcileEarnVaultPosition({
      authority: principal.walletAddress,
      cluster: resolveLoyalClusterForSolanaEnv(solanaEnv),
      connection: getConnection(solanaEnv),
      force: body.force === true,
      settings: principal.settingsPda,
      vaultPubkey: earnVaultPda.toBase58(),
    });

    return NextResponse.json(result);
  } catch (error) {
    console.warn("[earn-position] reconciliation failed", { error });
    return jsonError(
      500,
      "reconcile_failed",
      error instanceof Error
        ? error.message
        : "Failed to reconcile Earn position."
    );
  }
}
