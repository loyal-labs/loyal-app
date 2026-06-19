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
  serializeEarnDepositOnboardingState,
  serializeAutodepositState,
  serializeRoutePolicyState,
  type CurrentEarnAutodepositStateWithProgress,
} from "@/lib/yield-optimization/earn-state-serializers.server";
import {
  deriveEarnDepositOnboardingNextStep,
  findActiveYieldRoutePolicyPair,
  findCurrentEarnDepositOnboardingAttempt,
  findCurrentNonzeroYieldVaultReservePositions,
  findCurrentYieldVaultIdleTokenBalances,
  findReconciledActiveYieldPositionForVault,
  type UserYieldPositionRecord,
} from "@/lib/yield-optimization/yield-deposit-repository.server";

const EARN_VAULT_INDEX = 1;

function resolveConfiguredCluster() {
  const solanaEnv = resolveLoyalWebSolanaEnvFromEnv(process.env);
  return resolveLoyalClusterForSolanaEnv(solanaEnv);
}

function serializePosition(
  position: UserYieldPositionRecord,
  currentTotalAmountRaw: bigint
) {
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
    currentTotalAmountRaw: currentTotalAmountRaw.toString(),
    principalAmountRaw: position.principalAmountRaw.toString(),
    status: position.status,
  };
}

async function loadCurrentTotalAmountRaw(args: {
  cluster: ReturnType<typeof resolveConfiguredCluster>;
  position: UserYieldPositionRecord;
  settings: string;
  walletAddress: string;
}): Promise<bigint> {
  try {
    const [reserveRows, idleRows] = await Promise.all([
      findCurrentNonzeroYieldVaultReservePositions({
        cluster: args.cluster,
        settings: args.settings,
        vaultIndex: EARN_VAULT_INDEX,
        vaultPubkey: args.position.vaultPubkey,
        walletAddress: args.walletAddress,
      }),
      findCurrentYieldVaultIdleTokenBalances({
        cluster: args.cluster,
        settings: args.settings,
        vaultIndex: EARN_VAULT_INDEX,
        vaultPubkey: args.position.vaultPubkey,
        walletAddress: args.walletAddress,
      }),
    ]);
    const total = [...reserveRows, ...idleRows].reduce(
      (sum, row) => sum + row.amountRaw,
      BigInt(0)
    );
    return total > BigInt(0) ? total : args.position.currentAmountRaw;
  } catch (error) {
    console.warn("[earn-state] failed to load current holdings total", error);
    return args.position.currentAmountRaw;
  }
}

async function loadEarnStatePart<T>(
  name: "autodeposit" | "onboarding" | "policy" | "position",
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
  const [positionResult, policyResult, onboardingResult, autodepositResult] =
    await Promise.all([
      loadEarnStatePart("position", () =>
        findReconciledActiveYieldPositionForVault({
          cluster,
          settings: principal.settingsPda,
          vaultIndex: EARN_VAULT_INDEX,
          walletAddress: principal.walletAddress,
        })
      ),
      loadEarnStatePart("policy", () =>
        findActiveYieldRoutePolicyPair({
          authority: principal.walletAddress,
          cluster,
          settings: principal.settingsPda,
          vaultIndex: EARN_VAULT_INDEX,
          vaultPubkey: earnVaultPda.toBase58(),
        })
      ),
      loadEarnStatePart("onboarding", () =>
        findCurrentEarnDepositOnboardingAttempt({
          settings: principal.settingsPda,
          vaultIndex: EARN_VAULT_INDEX,
          vaultPubkey: earnVaultPda.toBase58(),
          walletAddress: principal.walletAddress,
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
  const policyPair = policyResult.data;
  const policy = policyPair?.routePolicy ?? null;
  const onboarding = onboardingResult.data;
  const autodeposit = autodepositResult.data;
  const currentTotalAmountRaw = position
    ? await loadCurrentTotalAmountRaw({
        cluster,
        position,
        settings: principal.settingsPda,
        walletAddress: principal.walletAddress,
      })
    : BigInt(0);
  const loadErrors = {
    ...(positionResult.error ? { position: true } : {}),
    ...(policyResult.error ? { policy: true } : {}),
    ...(onboardingResult.error ? { onboarding: true } : {}),
    ...(autodepositResult.error ? { autodeposit: true } : {}),
  };
  const onboardingNextStep = deriveEarnDepositOnboardingNextStep({
    attempt: onboarding,
    hasActivePosition: Boolean(position),
    policyPair,
  });

  return NextResponse.json({
    autodeposit: autodeposit ? serializeAutodepositState(autodeposit) : null,
    canonicalVaultPubkey: canonicalVaultPda.toBase58(),
    loadErrors,
    onboarding: serializeEarnDepositOnboardingState({
      attempt: onboarding,
      nextStep: onboardingNextStep,
    }),
    policy: policy
      ? serializeRoutePolicyState(policy, policyPair?.setupPolicy ?? null)
      : null,
    position: position
      ? serializePosition(position, currentTotalAmountRaw)
      : null,
    settingsPda: principal.settingsPda,
    vault: {
      accountIndex: EARN_VAULT_INDEX,
      pubkey: earnVaultPda.toBase58(),
    },
  });
}
