import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { PublicKey } from "@solana/web3.js";

import { findCurrentUser } from "@/features/chat/server/app-user";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { decodeWalletAddress } from "@/features/identity/server/wallet-auth-signature";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { getServerEnv } from "@/lib/core/config/server";
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
    const programId = new PublicKey(getServerEnv().loyalSmartAccounts.programId);
    const [earnVaultPda] = pda.getSmartAccountPda({
      accountIndex: EARN_VAULT_INDEX,
      programId,
      settingsPda: new PublicKey(account.settingsPda),
    });

    const [reserveRows, idleRows, position] = await Promise.all([
      findCurrentNonzeroYieldVaultReservePositions({
        cluster,
        settings: account.settingsPda,
        vaultIndex: EARN_VAULT_INDEX,
        vaultPubkey: earnVaultPda.toBase58(),
        walletAddress,
      }),
      findCurrentYieldVaultIdleTokenBalances({
        cluster,
        settings: account.settingsPda,
        vaultIndex: EARN_VAULT_INDEX,
        vaultPubkey: earnVaultPda.toBase58(),
        walletAddress,
      }),
      findReconciledActiveYieldPositionForVault({
        cluster,
        settings: account.settingsPda,
        vaultIndex: EARN_VAULT_INDEX,
        walletAddress,
      }),
    ]);

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

    let sources: WithdrawSource[] = [...reserveSources, ...idleSources];
    if (
      sources.length === 0 &&
      position &&
      position.currentAmountRaw > BigInt(0) &&
      position.currentMarket
    ) {
      sources = [
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
      ];
    }

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
