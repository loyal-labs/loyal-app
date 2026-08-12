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
import {
  findActiveYieldPositionsForVault,
  findActiveYieldRoutePolicyPair,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

// Read-only mobile twin of the web client's live on-chain Earn holdings read
// (`earn-rpc-holdings.client.ts`, summed by the sidebar for its headline
// balance). The DB snapshot that `mobile/earn/state` reads lags the chain (and
// doesn't track non-idle venue holdings), so the native balance was stale; this
// reads the vault's current holdings — Kamino obligations plus every policy
// mint's idle ATA — directly
// from the chain via the same `fetchEarnRpcHoldingsSnapshot` the web uses.
//
// Keyed by wallet address (the native app holds no signer, to avoid a Seed Vault
// prompt on a passive balance view) — this only reads public on-chain accounts
// for a vault the caller already knows, and never provisions or writes. Returns
// an empty snapshot when the wallet has no app user, smart account, or active
// Earn policy yet.
//
// Stale-read protection: the RPC pool can serve a lagging node whose account
// view predates a deposit the DB already confirmed, and the client trusts a
// successful live read over the read-model. Primary defense: every chain read
// carries minContextSlot = the position's last confirmed slot, so a lagging
// node errors instead of answering (a max-observed-slot check alone cannot
// catch a mixed read where only the obligation request hit a lagging node).
// Fallbacks: one retry on rejection, then 502 → the client keeps the
// read-model balance; plus a residual observedAt: null suppression should a
// stale snapshot slip through anyway.
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
    currentTotalNominalUsdMicros: "0",
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

    const account = await findReadyCurrentUserSmartAccount({
      userId: user.id,
      walletAddress,
    });
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

    // The newest confirmed slot across every mint-scoped accounting row anchors
    // the freshness floor
    // for every chain read below. The snapshot spans two RPC requests that can
    // land on different nodes; without minContextSlot a lagging node can serve
    // the obligation as it looked BEFORE a confirmed deposit/withdrawal while
    // the other request looks fresh — the exact "balance flashes an old value"
    // bug. With it, a lagging node errors instead of answering.
    const positions = await findActiveYieldPositionsForVault({
      cluster,
      settings: account.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress,
    });
    const confirmedSlotFloor = positions.reduce(
      (latest, position) =>
        position.currentObservedSlot > latest
          ? position.currentObservedSlot
          : latest,
      BigInt(0)
    );
    const minContextSlot =
      confirmedSlotFloor > BigInt(0) ? Number(confirmedSlotFloor) : undefined;

    const readSnapshot = () =>
      fetchEarnRpcHoldingsSnapshot({
        cluster,
        connection: getConnection(solanaEnv),
        minContextSlot,
        policy: serializeRoutePolicyState(
          policyPair.routePolicy,
          policyPair.setupPolicy ?? null
        ),
        programId,
        settingsPda,
      });
    let snapshot;
    try {
      snapshot = await readSnapshot();
    } catch (error) {
      if (minContextSlot === undefined) {
        throw error;
      }
      // A node behind the freshness floor rejects the read — retry once, the
      // next request usually lands on a caught-up node. A second failure falls
      // through to the outer catch (502), and the client keeps the read-model
      // balance instead of showing stale chain state.
      console.warn("[mobile-earn-holdings] snapshot read retried", {
        errorMessage:
          error instanceof Error ? error.message : "Unknown read error.",
        minContextSlot,
        walletAddress,
      });
      snapshot = await readSnapshot();
    }

    const staleLiveRead =
      confirmedSlotFloor > BigInt(0) &&
      BigInt(snapshot.observedSlot) < confirmedSlotFloor;
    if (staleLiveRead) {
      console.warn("[mobile-earn-holdings] stale live read suppressed", {
        confirmedSlot: confirmedSlotFloor.toString(),
        observedSlot: snapshot.observedSlot,
        walletAddress,
      });
    }

    return NextResponse.json({
      currentTotalAmountRaw: snapshot.currentTotalAmountRaw,
      currentTotalNominalUsdMicros: snapshot.currentTotalNominalUsdMicros,
      holdings: snapshot.holdings,
      observedAt: staleLiveRead ? null : snapshot.observedAt,
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
