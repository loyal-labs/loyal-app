import { NextResponse } from "next/server";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { findCurrentUser } from "@/features/chat/server/app-user";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { decodeWalletAddress } from "@/features/identity/server/wallet-auth-signature";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { scanEarnPolicyRefunds } from "@/lib/yield-optimization/earn-policy-refund.server";

// Mobile twin of the session `policy-refunds/scan` route. Like the mobile
// `earn/transactions` twin this is a passive read keyed by a supplied wallet
// address, not a signed request — the app auto-scans when the experimental
// toggle is on, and a wallet signature here would force a Seed Vault biometric
// prompt on every scan. Everything returned is public chain state plus
// non-sensitive liveness flags; the prepare twin (which returns a signable
// transaction) does require a wallet signature.
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

export async function GET(request: Request) {
  const walletAddress =
    new URL(request.url).searchParams.get("walletAddress")?.trim() ?? "";
  if (!walletAddress) {
    return jsonError(400, "invalid_request", "walletAddress is required.");
  }
  try {
    // Throws a 400 WalletAuthError when the address isn't a valid 32-byte key.
    decodeWalletAddress(walletAddress);
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(400, "invalid_request", "walletAddress is invalid.");
  }

  try {
    const user = await findCurrentUser({
      authMethod: "wallet",
      provider: "solana",
      subjectAddress: walletAddress,
      walletAddress,
    });
    if (!user) {
      return NextResponse.json({ scan: null });
    }

    const account = await findReadyCurrentUserSmartAccount({
      userId: user.id,
      walletAddress,
    });
    if (!account) {
      return NextResponse.json({ scan: null });
    }

    const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
    const scan = await scanEarnPolicyRefunds({
      connection: getConnection(solanaEnv),
      programId: new PublicKey(getServerEnv().loyalSmartAccounts.programId),
      settingsPda: account.settingsPda,
      solanaEnv,
      walletAddress,
    });

    return NextResponse.json({ scan });
  } catch (error) {
    console.error("[mobile-earn-policy-refunds-scan] failed", {
      errorMessage: error instanceof Error ? error.message : String(error),
      walletAddress,
    });
    return jsonError(
      500,
      "scan_failed",
      error instanceof Error ? error.message : "Failed to scan for refunds."
    );
  }
}
