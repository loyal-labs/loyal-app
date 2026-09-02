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
import { getServerEnv } from "@/lib/core/config/server";
import { getCurrentReserveUpdatesByReserve } from "@/lib/kamino/timescale-reserve-client.server";
import { findEarnCrossMintSnapshot } from "@/lib/yield-optimization/earn-cross-mint-repository.server";
import {
  findActiveYieldPositionsForVault,
  findActiveYieldRoutePolicyPair,
  findCurrentEarnDepositOnboardingAttempt,
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

// The wallet can hold one active position row per product mint (ASK-1355), so
// the headline balance is the sum of every ACTIVE position row — exactly what
// the deposit/withdraw confirms write synchronously, which is the value the
// mobile client trusts in its short post-mutation window before live holdings
// catch up. The vault snapshot tables are deliberately NOT used here: the
// routing worker records reserve rows in collateral-unit semantics
// (`kamino_obligation_collateral_deposited_amount`), which the user-facing
// filter drops wholesale, collapsing that "total" to idle dust — the $0.00
// balance regression right after a USDG deposit (2026-08-14). Falls back to
// the reconciled single row's amount when the plural read is empty or fails.
async function loadCurrentTotalAmountRaw(args: {
  cluster: ReturnType<typeof resolveConfiguredCluster>;
  position: UserYieldPositionRecord;
  settings: string;
  walletAddress: string;
}): Promise<bigint> {
  try {
    const rows = await findActiveYieldPositionsForVault({
      cluster: args.cluster,
      settings: args.settings,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress: args.walletAddress,
    });
    const total = rows.reduce(
      (sum, row) => sum + row.currentAmountRaw,
      BigInt(0)
    );
    return total > BigInt(0) ? total : args.position.currentAmountRaw;
  } catch (error) {
    console.warn(
      "[mobile-earn-state] failed to sum active position rows",
      error
    );
    return args.position.currentAmountRaw;
  }
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
    const match =
      rows.find((row) => row.reserve === reserve) ?? rows[0] ?? null;
    return match ? toApyBps(match.supplyApy) : null;
  } catch (error) {
    console.warn(
      "[mobile-earn-state] APY lookup failed; returning null",
      error
    );
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

  const cluster = resolveConfiguredCluster();
  const programId = getServerEnv().loyalSmartAccounts.programId;
  const emptyState = {
    autoswapPolicyAccounts: [],
    autoswapStateAuthoritative: true,
    protectedPolicyAccounts: [],
    cluster,
    position: null,
    programId,
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

    const account = await findReadyCurrentUserSmartAccount({
      userId: user.id,
      walletAddress,
    });
    if (!account) {
      return NextResponse.json(emptyState);
    }

    const [position, autoswapSnapshot, policyPair, onboardingAttempt] =
      await Promise.all([
        findReconciledActiveYieldPositionForVault({
          cluster,
          settings: account.settingsPda,
          vaultIndex: EARN_VAULT_INDEX,
          walletAddress,
        }),
        findEarnCrossMintSnapshot({
          authority: walletAddress,
          cluster,
          settings: account.settingsPda,
          vaultIndex: EARN_VAULT_INDEX,
          vaultPubkey: account.smartAccountAddress,
        }),
        findActiveYieldRoutePolicyPair({
          authority: walletAddress,
          cluster,
          settings: account.settingsPda,
          vaultIndex: EARN_VAULT_INDEX,
          vaultPubkey: account.smartAccountAddress,
        }),
        findCurrentEarnDepositOnboardingAttempt({
          settings: account.settingsPda,
          vaultIndex: EARN_VAULT_INDEX,
          vaultPubkey: account.smartAccountAddress,
          walletAddress,
        }),
      ]);
    const autoswapPolicyAccounts = autoswapSnapshot.autoswapIndex.policies.map(
      (policy) => policy.account
    );
    const autoswapStateAuthoritative =
      autoswapSnapshot.autoswapIndex.state !== "ambiguous";
    const protectedPolicyAccounts = Array.from(
      new Set(
        [
          policyPair?.routePolicy.policyAccount,
          policyPair?.setupPolicy?.policyAccount,
          onboardingAttempt?.policyAccount,
          onboardingAttempt?.setupPolicyAccount,
        ].filter((value): value is string => Boolean(value))
      )
    );
    if (!position) {
      return NextResponse.json({
        autoswapPolicyAccounts,
        autoswapStateAuthoritative,
        cluster,
        position: null,
        programId,
        protectedPolicyAccounts,
        settingsPda: account.settingsPda,
        smartAccountAddress: account.smartAccountAddress,
      });
    }

    const [currentSupplyApyBps, currentTotalAmountRaw] = await Promise.all([
      loadCurrentSupplyApyBps(position),
      loadCurrentTotalAmountRaw({
        cluster,
        position,
        settings: account.settingsPda,
        walletAddress,
      }),
    ]);

    return NextResponse.json({
      autoswapPolicyAccounts,
      autoswapStateAuthoritative,
      cluster,
      position: {
        currentAmountRaw: currentTotalAmountRaw.toString(),
        currentSupplyApyBps,
        principalAmountRaw: position.principalAmountRaw.toString(),
        status: position.status,
      },
      programId,
      protectedPolicyAccounts,
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
