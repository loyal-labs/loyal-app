import { NextResponse } from "next/server";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import {
  assertAuthenticatedWalletControlsSettings,
  isSmartAccountProvisioningError,
} from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import {
  EarnPolicyRefundError,
  prepareEarnPolicyRefund,
} from "@/lib/yield-optimization/earn-policy-refund.server";
import {
  parseEarnPolicyRefundPrepareRequestBody,
  type EarnPolicyRefundPrepareRequestBody,
} from "@/lib/yield-optimization/earn-policy-refund-contracts.shared";

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

  let parsed: EarnPolicyRefundPrepareRequestBody;
  try {
    parsed = parseEarnPolicyRefundPrepareRequestBody(await request.json());
  } catch (error) {
    return jsonError(
      400,
      "invalid_request",
      error instanceof Error ? error.message : "Invalid request body."
    );
  }

  try {
    await assertAuthenticatedWalletControlsSettings({
      settingsPda: principal.settingsPda,
      smartAccountAddress: principal.smartAccountAddress,
      walletAddress: principal.walletAddress,
    });

    const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
    const response = await prepareEarnPolicyRefund(
      {
        connection: getConnection(solanaEnv),
        programId: new PublicKey(getServerEnv().loyalSmartAccounts.programId),
        settingsPda: principal.settingsPda,
        solanaEnv,
        walletAddress: principal.walletAddress,
      },
      parsed
    );

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof EarnPolicyRefundError) {
      return jsonError(error.status, error.code, error.message);
    }
    if (isSmartAccountProvisioningError(error)) {
      return jsonError(error.status, error.code, error.message);
    }

    console.error("[earn-policy-refunds-prepare] failed", {
      errorMessage: error instanceof Error ? error.message : String(error),
      requestedAccount:
        parsed.kind === "recurring_delegation"
          ? parsed.recurringDelegation
          : parsed.kind === "vault"
            ? "vault"
            : parsed.policyAccount,
      settings: principal.settingsPda,
      walletAddress: principal.walletAddress,
    });
    return jsonError(
      500,
      "prepare_failed",
      error instanceof Error ? error.message : "Failed to prepare refund."
    );
  }
}
