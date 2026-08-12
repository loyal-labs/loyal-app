import { NextResponse } from "next/server";
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
import {
  EarnPolicyRefundError,
  prepareEarnPolicyRefund,
} from "@/lib/yield-optimization/earn-policy-refund.server";
import {
  parseEarnPolicyRefundPrepareRequestBody,
  type EarnPolicyRefundPrepareRequestBody,
} from "@/lib/yield-optimization/earn-policy-refund-contracts.shared";

// Mobile twin of the session `policy-refunds/prepare` route: same shared core,
// but authenticated by a wallet signature instead of a session. The prepared
// transaction pays out to (and must be signed by) the authenticated wallet,
// so a stolen request body cannot redirect a refund. Refunding requires an
// existing smart account; this never provisions.
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
      purpose: "earn-refund-prepare",
    }));
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(401, "unauthenticated", "Mobile wallet auth failed.");
  }

  let parsed: EarnPolicyRefundPrepareRequestBody;
  try {
    parsed = parseEarnPolicyRefundPrepareRequestBody(body);
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
    console.error("[mobile-earn-policy-refunds-prepare] resolve failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown resolve error.",
      walletAddress,
    });
    return jsonError(
      500,
      "smart_account_resolve_failed",
      "Failed to resolve the smart account for this wallet."
    );
  }

  try {
    const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
    const response = await prepareEarnPolicyRefund(
      {
        connection: getConnection(solanaEnv),
        programId: new PublicKey(getServerEnv().loyalSmartAccounts.programId),
        settingsPda,
        solanaEnv,
        walletAddress,
      },
      parsed
    );

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof EarnPolicyRefundError) {
      return jsonError(error.status, error.code, error.message);
    }

    console.error("[mobile-earn-policy-refunds-prepare] failed", {
      errorMessage: error instanceof Error ? error.message : String(error),
      requestedAccount:
        parsed.kind === "recurring_delegation"
          ? parsed.recurringDelegation
          : parsed.kind === "vault"
            ? "vault"
            : parsed.policyAccount,
      settings: settingsPda,
      walletAddress,
    });
    return jsonError(
      500,
      "prepare_failed",
      error instanceof Error ? error.message : "Failed to prepare refund."
    );
  }
}
