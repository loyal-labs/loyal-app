import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
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
import { fetchEarnRpcHoldingsSnapshot } from "@/lib/yield-optimization/earn-rpc-holdings.client";
import { serializeRoutePolicyState } from "@/lib/yield-optimization/earn-state-serializers.server";
import { findActiveYieldRoutePolicyPair } from "@/lib/yield-optimization/yield-deposit-repository.server";

// Read-only mobile twin of the web client's live on-chain Earn holdings read
// (`earn-rpc-holdings.client.ts`, summed by the sidebar for its headline
// balance). The DB snapshot that `mobile/earn/state` reads lags the chain (and
// doesn't track non-idle venue holdings), so the native balance was stale; this
// reads the vault's current holdings — Kamino obligations + idle USDC — directly
// from the chain via the same `fetchEarnRpcHoldingsSnapshot` the web uses.
//
// Keyed by wallet address (the native app holds no signer, to avoid a Seed Vault
// prompt on a passive balance view) — this only reads public on-chain accounts
// for a vault the caller already knows, and never writes/provisions. Returns an
// empty snapshot when the wallet has no app user / smart account / active Earn
// policy yet.
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

  const solanaEnv = getConfiguredSolanaEnv();
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);

  const emptySnapshot = {
    currentTotalAmountRaw: "0",
    holdings: [],
    observedAt: null,
    observedSlot: null,
    settingsPda: null,
    smartAccountAddress: null,
  };

  try {
    const user = await findCurrentUser({
      authMethod: "wallet",
      provider: "solana",
      subjectAddress: walletAddress,
      walletAddress,
    });
    if (!user) {
      return NextResponse.json(emptySnapshot);
    }

    const account = await findReadyCurrentUserSmartAccount({ userId: user.id });
    if (!account) {
      return NextResponse.json(emptySnapshot);
    }

    const serverEnv = getServerEnv();
    const programId = new PublicKey(serverEnv.loyalSmartAccounts.programId);
    const settingsPda = new PublicKey(account.settingsPda);
    const [earnVaultPda] = pda.getSmartAccountPda({
      accountIndex: EARN_VAULT_INDEX,
      programId,
      settingsPda,
    });

    // The live holdings read needs the active Earn route policy (the Safe
    // Kamino market universe to scan); without one there's nothing deployed yet.
    const policyPair = await findActiveYieldRoutePolicyPair({
      authority: walletAddress,
      cluster,
      settings: account.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      vaultPubkey: earnVaultPda.toBase58(),
    });
    if (!policyPair?.routePolicy) {
      return NextResponse.json({
        ...emptySnapshot,
        settingsPda: account.settingsPda,
        smartAccountAddress: account.smartAccountAddress,
      });
    }

    const snapshot = await fetchEarnRpcHoldingsSnapshot({
      cluster,
      connection: getConnection(solanaEnv),
      policy: serializeRoutePolicyState(
        policyPair.routePolicy,
        policyPair.setupPolicy ?? null
      ),
      programId,
      settingsPda,
    });

    return NextResponse.json({
      currentTotalAmountRaw: snapshot.currentTotalAmountRaw,
      holdings: snapshot.holdings,
      observedAt: snapshot.observedAt,
      observedSlot: snapshot.observedSlot,
      settingsPda: account.settingsPda,
      smartAccountAddress: account.smartAccountAddress,
    });
  } catch (error) {
    console.error("[mobile-earn-holdings] read failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown read error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(502, "earn_holdings_failed", "Failed to load Earn holdings.");
  }
}
