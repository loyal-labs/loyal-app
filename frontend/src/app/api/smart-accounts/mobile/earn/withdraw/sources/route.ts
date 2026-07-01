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
import {
  fetchEarnRpcHoldingsSnapshot,
  type EarnRpcHolding,
} from "@/lib/yield-optimization/earn-rpc-holdings.client";
import { serializeRoutePolicyState } from "@/lib/yield-optimization/earn-state-serializers.server";
import { findActiveYieldRoutePolicyPair } from "@/lib/yield-optimization/yield-deposit-repository.server";

// Read-only list of the wallet's Earn withdrawal sources (per-reserve positions
// + idle vault USDC), keyed by wallet address (no signature, no provisioning).
//
// Sourced from the LIVE on-chain holdings snapshot (`fetchEarnRpcHoldingsSnapshot`
// — the same read `/holdings` and the positions sheet use), NOT the DB
// read-model. The read-model can't follow a cross-market rebalance (its reconcile
// only re-checks reserves it already knows), so it reported a stale
// reserve/market/amount that the picker showed and `withdraw/prepare` then
// rejected. The snapshot scans the policy's markets and reflects reality. Each
// item still carries the prepare-source identifiers (type/id/reserve/
// tokenAccount/mint) so a `withdraw/prepare` call can match it.
const EARN_VAULT_INDEX = 1 as const;

const connectionCache = new Map<SolanaEnv, Connection>();

type WithdrawSource = {
  type: "reserve" | "idle";
  id: string;
  label: string;
  amountRaw: string;
  liquidityMint: string;
  market: string | null;
  reserve: string | null;
  tokenAccount: string | null;
};

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

function getConnection(env: SolanaEnv): Connection {
  const cached = connectionCache.get(env);
  if (cached) {
    return cached;
  }
  const { rpcEndpoint, websocketEndpoint } = getServerSolanaEndpoints(env);
  const connection = new Connection(rpcEndpoint, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    wsEndpoint: websocketEndpoint,
  });
  connectionCache.set(env, connection);
  return connection;
}

function isPositiveAmount(amountRaw: string): boolean {
  try {
    return BigInt(amountRaw) > BigInt(0);
  } catch {
    return false;
  }
}

// Maps a live holdings snapshot entry to a withdraw source. Drops entries we
// can't offer as a withdrawal (zero balance, or missing the identifiers a
// `withdraw/prepare` call needs to match/build the instruction).
function holdingToWithdrawSource(
  holding: EarnRpcHolding
): WithdrawSource | null {
  if (!isPositiveAmount(holding.amountRaw)) {
    return null;
  }
  if (holding.kind === "idle") {
    const tokenAccount = holding.provenance.tokenAccount;
    if (!tokenAccount) {
      return null;
    }
    return {
      type: "idle",
      id: tokenAccount,
      label: "Idle USDC",
      amountRaw: holding.amountRaw,
      liquidityMint: holding.liquidityMint,
      market: null,
      reserve: null,
      tokenAccount,
    };
  }
  if (!holding.reserve || !holding.market) {
    return null;
  }
  return {
    type: "reserve",
    id: holding.reserve,
    label: "USDC reserve",
    amountRaw: holding.amountRaw,
    liquidityMint: holding.liquidityMint,
    market: holding.market,
    reserve: holding.reserve,
    tokenAccount: null,
  };
}

export async function GET(request: Request) {
  const walletAddress =
    new URL(request.url).searchParams.get("walletAddress")?.trim() ?? "";
  if (!walletAddress) {
    return jsonError(400, "invalid_request", "walletAddress is required.");
  }
  try {
    decodeWalletAddress(walletAddress);
  } catch (error) {
    if (error instanceof WalletAuthError) {
      return jsonError(error.status, error.code, error.message);
    }
    return jsonError(400, "invalid_request", "walletAddress is invalid.");
  }

  const emptyState = {
    sources: [] as WithdrawSource[],
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
      return NextResponse.json(emptyState);
    }

    const account = await findReadyCurrentUserSmartAccount({ userId: user.id });
    if (!account) {
      return NextResponse.json(emptyState);
    }

    const solanaEnv = getConfiguredSolanaEnv();
    const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
    const programId = new PublicKey(getServerEnv().loyalSmartAccounts.programId);
    const settingsPda = new PublicKey(account.settingsPda);
    const [earnVaultPda] = pda.getSmartAccountPda({
      accountIndex: EARN_VAULT_INDEX,
      programId,
      settingsPda,
    });

    // The live holdings read needs the active Earn route policy (the market
    // universe to scan). No policy → nothing is deployed yet.
    const policyPair = await findActiveYieldRoutePolicyPair({
      authority: walletAddress,
      cluster,
      settings: account.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      vaultPubkey: earnVaultPda.toBase58(),
    });
    if (!policyPair?.routePolicy) {
      return NextResponse.json({
        sources: [] as WithdrawSource[],
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

    const sources = snapshot.holdings
      .map(holdingToWithdrawSource)
      .filter((source): source is WithdrawSource => source !== null);

    return NextResponse.json({
      sources,
      settingsPda: account.settingsPda,
      smartAccountAddress: account.smartAccountAddress,
    });
  } catch (error) {
    console.error("[mobile-earn-withdraw-sources] read failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown read error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(
      502,
      "withdraw_sources_failed",
      "Failed to load Earn withdrawal sources."
    );
  }
}
