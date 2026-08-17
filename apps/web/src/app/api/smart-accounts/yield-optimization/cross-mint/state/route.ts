import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { isEarnAutoswapEnrollmentEnabled } from "@/lib/yield-optimization/earn-autoswap-rollout.server";
import { findEarnCrossMintState } from "@/lib/yield-optimization/earn-cross-mint-repository.server";
import { hasActiveEarnPosition } from "@/lib/yield-optimization/earn-position-gate.server";

const EARN_VAULT_INDEX = 1;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);
  if (!principal) {
    return jsonError(401, "unauthenticated", "No active auth session.");
  }

  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  if (solanaEnv !== "mainnet") {
    return jsonError(409, "unsupported_cluster", "Autoswap requires mainnet.");
  }
  const cluster = resolveLoyalClusterForSolanaEnv(solanaEnv);
  const programId = new PublicKey(getServerEnv().loyalSmartAccounts.programId);
  const vaultPubkey = pda.getSmartAccountPda({
    accountIndex: EARN_VAULT_INDEX,
    programId,
    settingsPda: new PublicKey(principal.settingsPda),
  })[0];

  try {
    const [autoswap, hasPosition] = await Promise.all([
      findEarnCrossMintState({
        authority: principal.walletAddress,
        cluster,
        settings: principal.settingsPda,
        vaultIndex: EARN_VAULT_INDEX,
        vaultPubkey: vaultPubkey.toBase58(),
      }),
      hasActiveEarnPosition({
        cluster,
        settingsPda: principal.settingsPda,
        walletAddress: principal.walletAddress,
      }),
    ]);
    let canEnroll = false;
    try {
      canEnroll = isEarnAutoswapEnrollmentEnabled(principal.walletAddress);
    } catch {
      // Invalid rollout configuration fails closed for new enrollment while an
      // existing enrollment remains visible and manageable.
    }
    return NextResponse.json({
      autoswap,
      autoswapAvailable: canEnroll || autoswap !== null,
      position: hasPosition ? { status: "active" } : null,
      settingsPda: principal.settingsPda,
      vault: {
        accountIndex: EARN_VAULT_INDEX,
        pubkey: vaultPubkey.toBase58(),
      },
    });
  } catch (error) {
    return jsonError(
      500,
      "autoswap_state_failed",
      error instanceof Error ? error.message : "Failed to load Autoswap state."
    );
  }
}
