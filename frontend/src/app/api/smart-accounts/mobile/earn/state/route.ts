import { NextResponse } from "next/server";
import {
  LoyalCluster,
  getKaminoUsdcEarnTargetForCluster,
  resolveLoyalClusterForSolanaEnv,
} from "@loyal-labs/actions";

import { findCurrentUser } from "@/features/chat/server/app-user";
import { WalletAuthError } from "@/features/identity/server/wallet-auth-errors";
import { decodeWalletAddress } from "@/features/identity/server/wallet-auth-signature";
import { findReadyCurrentUserSmartAccount } from "@/features/smart-accounts/server/service";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getCurrentReserveUpdatesByReserve } from "@/lib/kamino/timescale-reserve-client.server";
import {
  findReconciledActiveYieldPositionForVault,
  type UserYieldPositionRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

// Read-only mobile twin of the session `yield-optimization/{earn-state,position}`
// routes. The native Earn tab shows balance passively, with no signer held (a
// wallet signature would force a Seed Vault biometric prompt on every view), so
// this lookup is keyed by a supplied wallet address rather than a signed
// request. That is safe because it:
//   - never writes or provisions a smart account (no sponsor/SOL cost — the
//     abuse vector that the deposit-prepare path has to guard does not exist
//     here), and
//   - returns only public, on-chain-derived data (vault balance + live APY) for
//     a wallet the caller already knows. The wallet -> smart-account mapping it
//     reveals is already discoverable from that wallet's on-chain tx history.
// If the wallet has no app user / smart account / position yet, it returns an
// empty state instead of creating anything.
const EARN_VAULT_INDEX = 1;

function jsonError(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function resolveConfiguredCluster() {
  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  return resolveLoyalClusterForSolanaEnv(solanaEnv);
}

function toApyBps(supplyApy: number): string {
  return Math.round(supplyApy * 10_000).toString();
}

// Devnet positions have no Timescale APY data; borrow the mainnet reserve's APY
// for display (mirrors the session `position` route).
function resolveTimescaleReserveForPosition(position: UserYieldPositionRecord) {
  const mainnetEarnTarget = getKaminoUsdcEarnTargetForCluster(
    LoyalCluster.MainnetBeta
  );
  const devnetEarnTarget = getKaminoUsdcEarnTargetForCluster(
    LoyalCluster.Devnet
  );
  if (
    position.currentReserve === devnetEarnTarget.reserve.toBase58() &&
    position.currentMarket === devnetEarnTarget.market.toBase58() &&
    position.currentLiquidityMint === devnetEarnTarget.liquidityMint.toBase58()
  ) {
    return mainnetEarnTarget.reserve.toBase58();
  }
  return position.currentReserve;
}

// Best-effort: the funded balance is the headline number; APY is supplementary,
// so a missing/empty Timescale read just yields null rather than failing.
async function loadCurrentSupplyApyBps(
  position: UserYieldPositionRecord
): Promise<string | null> {
  const reserve = resolveTimescaleReserveForPosition(position);
  try {
    const rows = await getCurrentReserveUpdatesByReserve({
      reserves: [reserve],
    });
    const match = rows.find((row) => row.reserve === reserve) ?? rows[0] ?? null;
    return match ? toApyBps(match.supplyApy) : null;
  } catch (error) {
    console.warn("[mobile-earn-state] APY lookup failed; returning null", error);
    return null;
  }
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

  const emptyState = {
    position: null,
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

    const cluster = resolveConfiguredCluster();
    const position = await findReconciledActiveYieldPositionForVault({
      cluster,
      settings: account.settingsPda,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress,
    });
    if (!position) {
      return NextResponse.json({
        position: null,
        settingsPda: account.settingsPda,
        smartAccountAddress: account.smartAccountAddress,
      });
    }

    const currentSupplyApyBps = await loadCurrentSupplyApyBps(position);

    return NextResponse.json({
      position: {
        currentAmountRaw: position.currentAmountRaw.toString(),
        currentSupplyApyBps,
        principalAmountRaw: position.principalAmountRaw.toString(),
        status: position.status,
      },
      settingsPda: account.settingsPda,
      smartAccountAddress: account.smartAccountAddress,
    });
  } catch (error) {
    console.error("[mobile-earn-state] read failed", {
      errorMessage:
        error instanceof Error ? error.message : "Unknown read error.",
      errorName: error instanceof Error ? error.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
    });
    return jsonError(502, "earn_state_failed", "Failed to load Earn state.");
  }
}
