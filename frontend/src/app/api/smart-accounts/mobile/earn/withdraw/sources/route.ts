import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";

import { findCurrentUser } from "@/features/chat/server/app-user";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { decodeWalletAddress } from "@/features/identity/server/wallet-auth-signature";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import {
  findCurrentNonzeroYieldVaultReservePositions,
  findCurrentYieldVaultIdleTokenBalances,
  findReconciledActiveYieldPositionForVault,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

// Read-only list of the wallet's Earn withdrawal sources (per-reserve positions
// + idle vault USDC), keyed by wallet address (no signature, no provisioning).
// Mirrors the source set the withdraw/prepare route builds, so the mobile
// source picker offers exactly the sources a `withdraw/prepare` call will
// accept. Each item carries both display fields (amount/label) and the
// prepare-source identifiers (type/id/reserve/tokenAccount/mint).
const EARN_VAULT_INDEX = 1 as const;

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

function shortenAddress(address: string): string {
  return address.length <= 8
    ? address
    : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function getConfiguredSolanaEnv(): SolanaEnv {
  return resolveLoyalWebSolanaEnvFromEnv(process.env);
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

    // Resolve the reconciled position FIRST so the reserve/idle snapshot lookups
    // key off the position's ACTUAL vault pubkey — matching the web `position`
    // route. Deriving the vault pubkey locally (getSmartAccountPda) can resolve
    // to a different managedVaults record than the one the reserve rows are
    // stored under, which returns zero reserve rows and forces the stale
    // `currentAmountRaw` fallback below — reporting the wrong reserve/market and
    // amount (the source of the mobile↔web withdraw discrepancy).
    const position = await findReconciledActiveYieldPositionForVault({
      cluster,
      settings: account.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress,
    });

    const [reserveRows, idleRows] = position
      ? await Promise.all([
          findCurrentNonzeroYieldVaultReservePositions({
            cluster,
            settings: account.settingsPda,
            vaultIndex: EARN_VAULT_INDEX,
            vaultPubkey: position.vaultPubkey,
            walletAddress,
          }),
          findCurrentYieldVaultIdleTokenBalances({
            cluster,
            settings: account.settingsPda,
            vaultIndex: EARN_VAULT_INDEX,
            vaultPubkey: position.vaultPubkey,
            walletAddress,
          }),
        ])
      : [[], []];

    const reserveRowsWithBalance = reserveRows.filter(
      (row) => row.amountRaw > BigInt(0) && row.market
    );
    const multipleReserves = reserveRowsWithBalance.length > 1;
    const reserveSources: WithdrawSource[] = reserveRowsWithBalance.map(
      (row) => ({
        type: "reserve",
        id: row.reserve,
        label: multipleReserves
          ? `USDC reserve ${shortenAddress(row.reserve)}`
          : "USDC reserve",
        amountRaw: row.amountRaw.toString(),
        liquidityMint: row.liquidityMint,
        market: row.market,
        reserve: row.reserve,
        tokenAccount: null,
      })
    );
    const idleSources: WithdrawSource[] = idleRows
      .filter((row) => row.amountRaw > BigInt(0))
      .map((row) => ({
        type: "idle",
        id: row.tokenAccount,
        label: "Idle USDC",
        amountRaw: row.amountRaw.toString(),
        liquidityMint: row.mint,
        market: null,
        reserve: null,
        tokenAccount: row.tokenAccount,
      }));

    // When no user-facing RESERVE rows surfaced, fall back to the reconciled
    // position's reserve holding. Keyed off `reserveSources.length === 0` (NOT
    // total sources) and merged alongside idle — mirroring `withdraw/prepare`'s
    // own fallback. The old `sources.length === 0` guard meant a dust idle
    // balance suppressed this fallback, dropping the (filtered-out) reserve
    // position entirely and leaving the sheet showing only idle dust. The
    // reserve row gets filtered out when the snapshot stores the Kamino position
    // under collateral semantics (`kamino_obligation_collateral_deposited_amount`)
    // instead of `kamino_redeemable_liquidity`.
    const positionFallbackSources: WithdrawSource[] =
      reserveSources.length === 0 &&
      position &&
      position.currentAmountRaw > BigInt(0) &&
      position.currentMarket
        ? [
            {
              type: "reserve",
              id: position.currentReserve,
              label: "USDC reserve",
              amountRaw: position.currentAmountRaw.toString(),
              liquidityMint: position.currentLiquidityMint,
              market: position.currentMarket,
              reserve: position.currentReserve,
              tokenAccount: null,
            },
          ]
        : [];
    const sources: WithdrawSource[] = [
      ...reserveSources,
      ...positionFallbackSources,
      ...idleSources,
    ];

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
