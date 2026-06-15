import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import { PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import {
  findCurrentEarnAutodepositState,
  findPendingEarnAutodepositScheduledSweeps,
  sumEarnAutodepositCurrentPeriodDeposits,
} from "@/lib/yield-optimization/earn-autodeposit-repository.server";
import {
  serializeAutodepositState,
  type CurrentEarnAutodepositStateWithProgress,
} from "@/lib/yield-optimization/earn-state-serializers.server";
import {
  findActiveYieldRoutePolicy,
  findReconciledActiveYieldPositionForVault,
  type RoutePolicyRecord,
  type UserYieldPositionRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

const EARN_VAULT_INDEX = 1;

function resolveConfiguredCluster() {
  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  return resolveLoyalClusterForSolanaEnv(solanaEnv);
}

function serializePosition(position: UserYieldPositionRecord) {
  return {
    currentHolding: {
      amountRaw: position.currentAmountRaw.toString(),
      liquidityMint: position.currentLiquidityMint,
      market: position.currentMarket,
      observedAt: position.currentObservedAt.toISOString(),
      observedSlot: position.currentObservedSlot.toString(),
      provenance: {
        lastHoldingEventId: position.lastHoldingEventId?.toString() ?? null,
        lastRebalanceDecisionId:
          position.lastRebalanceDecisionId?.toString() ?? null,
      },
      reserve: position.currentReserve,
    },
    id: position.id.toString(),
    initialHolding: {
      liquidityMint: position.initialLiquidityMint,
      market: position.initialMarket,
      reserve: position.initialReserve,
      supplyApyBps: position.initialSupplyApyBps?.toString() ?? null,
    },
    principalAmountRaw: position.principalAmountRaw.toString(),
    status: position.status,
  };
}

function serializePolicy(policy: RoutePolicyRecord) {
  return {
    account: policy.policyAccount,
    id: policy.id.toString(),
    seed: policy.policySeed.toString(),
    vaultIndex: policy.vaultIndex,
    vaultPubkey: policy.vaultPubkey,
  };
}

async function loadEarnStatePart<T>(
  name: "autodeposit" | "policy" | "position",
  loader: () => Promise<T | null>
): Promise<{ data: T | null; error: boolean }> {
  try {
    return { data: await loader(), error: false };
  } catch (error) {
    console.warn(`[earn-state] failed to load ${name}; returning null`, error);
    return { data: null, error: true };
  }
}

export async function GET(request: Request) {
  const principal = await resolveAuthenticatedPrincipalFromRequest(request);

  if (!principal) {
    return NextResponse.json(
      {
        error: {
          code: "unauthenticated",
          message: "No active auth session.",
        },
      },
      { status: 401 }
    );
  }

  const serverEnv = getServerEnv();
  const cluster = resolveConfiguredCluster();
  const settingsPda = new PublicKey(principal.settingsPda);
  const programId = new PublicKey(serverEnv.loyalSmartAccounts.programId);
  const [earnVaultPda] = pda.getSmartAccountPda({
    accountIndex: EARN_VAULT_INDEX,
    programId,
    settingsPda,
  });
  const [canonicalVaultPda] = pda.getSmartAccountPda({
    accountIndex: 0,
    programId,
    settingsPda,
  });
  const [positionResult, policyResult, autodepositResult] = await Promise.all([
    loadEarnStatePart("position", () =>
      findReconciledActiveYieldPositionForVault({
        cluster,
        settings: principal.settingsPda,
        vaultIndex: EARN_VAULT_INDEX,
        walletAddress: principal.walletAddress,
      })
    ),
    loadEarnStatePart("policy", () =>
      findActiveYieldRoutePolicy({
        authority: principal.walletAddress,
        cluster,
        settings: principal.settingsPda,
        vaultIndex: EARN_VAULT_INDEX,
        vaultPubkey: earnVaultPda.toBase58(),
      })
    ),
    loadEarnStatePart(
      "autodeposit",
      async (): Promise<CurrentEarnAutodepositStateWithProgress | null> => {
        const state = await findCurrentEarnAutodepositState({
          settings: principal.settingsPda,
          vaultIndex: EARN_VAULT_INDEX,
          walletAddress: principal.walletAddress,
        });
        if (!state) {
          return null;
        }

        const [depositedThisPeriodRaw, scheduledSweeps] = await Promise.all([
          sumEarnAutodepositCurrentPeriodDeposits(state.target),
          findPendingEarnAutodepositScheduledSweeps(state.target),
        ]);

        return { ...state, depositedThisPeriodRaw, scheduledSweeps };
      }
    ),
  ]);
  const position = positionResult.data;
  const policy = policyResult.data;
  const autodeposit = autodepositResult.data;
  const loadErrors = {
    ...(positionResult.error ? { position: true } : {}),
    ...(policyResult.error ? { policy: true } : {}),
    ...(autodepositResult.error ? { autodeposit: true } : {}),
  };

  return NextResponse.json({
    autodeposit: autodeposit ? serializeAutodepositState(autodeposit) : null,
    canonicalVaultPubkey: canonicalVaultPda.toBase58(),
    loadErrors,
    policy: policy ? serializePolicy(policy) : null,
    position: position ? serializePosition(position) : null,
    settingsPda: principal.settingsPda,
    vault: {
      accountIndex: EARN_VAULT_INDEX,
      pubkey: earnVaultPda.toBase58(),
    },
  });
}
