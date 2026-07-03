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
import { reconcileEarnVaultPosition } from "@/lib/yield-optimization/earn-position-reconciliation.server";
import { fetchEarnRpcHoldingsSnapshot } from "@/lib/yield-optimization/earn-rpc-holdings.client";
import { serializeRoutePolicyState } from "@/lib/yield-optimization/earn-state-serializers.server";
import {
  findActiveYieldPositionForVault,
  findActiveYieldRoutePolicyPair,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

// Read-only mobile twin of the web client's live on-chain Earn holdings read
// (`earn-rpc-holdings.client.ts`, summed by the sidebar for its headline
// balance). The DB snapshot that `mobile/earn/state` reads lags the chain (and
// doesn't track non-idle venue holdings), so the native balance was stale; this
// reads the vault's current holdings — Kamino obligations + idle USDC — directly
// from the chain via the same `fetchEarnRpcHoldingsSnapshot` the web uses.
//
// Keyed by wallet address (the native app holds no signer, to avoid a Seed Vault
// prompt on a passive balance view) — this only reads public on-chain accounts
// for a vault the caller already knows, and never provisions. Its only write is
// the read-model heal below, which re-derives the stored position from the same
// public chain state. Returns an empty snapshot when the wallet has no app user
// / smart account / active Earn policy yet.
//
// Read-model heal: the yield worker's sweep confirm can stamp the DB position
// with the obligation's raw cToken collateral amount (~0.84x the real USDC
// value). The web hides that because its headline is a client-side chain sum
// and its client fires POST /yield-optimization/position/reconcile on any
// divergence, rewriting the read-model. Mobile has no such trigger, so /state
// keeps serving the undercount (shown during the post-deposit trust window and
// whenever this live read fails). Mirror the web's heal here: when the live
// chain total is ABOVE the stored one by at least a cent, run the same
// reconcile. Up-direction only — right after a deposit the live read can
// transiently dip BELOW the freshly confirmed total (funds mid-flight into
// Kamino), and healing downward would reintroduce the very dip this fixes.
const EARN_VAULT_INDEX = 1;
const EARN_READ_MODEL_HEAL_MIN_DELTA_RAW = BigInt(10_000); // $0.01
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

    // Best-effort read-model heal (see the module comment). Never fails the
    // holdings response — the live snapshot above is already the answer.
    try {
      const position = await findActiveYieldPositionForVault({
        cluster,
        settings: account.settingsPda,
        vaultIndex: EARN_VAULT_INDEX,
        walletAddress,
      });
      const liveTotalAmountRaw = BigInt(snapshot.currentTotalAmountRaw);
      if (
        position !== null &&
        liveTotalAmountRaw - position.currentAmountRaw >=
          EARN_READ_MODEL_HEAL_MIN_DELTA_RAW
      ) {
        await reconcileEarnVaultPosition({
          authority: walletAddress,
          cluster,
          connection: getConnection(solanaEnv),
          force: true,
          settings: account.settingsPda,
          vaultPubkey: earnVaultPda.toBase58(),
        });
      }
    } catch (error) {
      console.warn("[mobile-earn-holdings] read-model heal failed", {
        errorMessage:
          error instanceof Error ? error.message : "Unknown heal error.",
        errorName: error instanceof Error ? error.name : typeof error,
        walletAddress,
      });
    }

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
