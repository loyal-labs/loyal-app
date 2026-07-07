import { NextResponse } from "next/server";
import { resolveLoyalClusterForSolanaEnv } from "@loyal-labs/actions";
import { pda } from "@loyal-labs/loyal-smart-accounts";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection, PublicKey } from "@solana/web3.js";

import { resolveAuthenticatedPrincipalFromRequest } from "@/features/identity/server/auth-session";
import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaEndpoints } from "@/lib/solana/rpc-endpoints.server";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";
import { probeEarnAutodepositArtifacts } from "@/lib/yield-optimization/earn-autodeposit-artifacts.server";
import { readEarnAutodepositBootstrapWalletBalanceSnapshot } from "@/lib/yield-optimization/earn-autodeposit-bootstrap.server";
import { getDeploymentPolicySignerPublicKey } from "@/lib/yield-optimization/deployment-policy-signer.server";
import {
  findCurrentEarnAutodepositState,
  findPendingEarnAutodepositScheduledSweeps,
  markAutodepositTargetActiveFromArtifacts,
  markAutodepositTargetPendingDelegation,
  reconcileStaleEarnAutodepositScheduledSweeps,
  scheduleBootstrapEarnAutodepositSweep,
  sumEarnAutodepositCurrentPeriodDeposits,
  type CurrentEarnAutodepositState,
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
const RECONCILE_BOOTSTRAP_BALANCE_SOURCE = "app_autodeposit_artifact_reconcile";
const RECONCILE_BOOTSTRAP_BALANCE_SOURCE_COMMITMENT = "confirmed";
const connectionCache = new Map<SolanaEnv, Connection>();

function resolveConfiguredSolanaEnv(): SolanaEnv {
  return resolveLoyalWebSolanaEnvFromEnv(process.env);
}

function resolveConfiguredCluster(solanaEnv = resolveConfiguredSolanaEnv()) {
  return resolveLoyalClusterForSolanaEnv(solanaEnv);
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

async function reconcileAutodepositArtifacts(args: {
  connection: Connection;
  settings: string;
  smartAccountsProgramId: PublicKey;
  state: CurrentEarnAutodepositState;
  walletAddress: string;
}): Promise<CurrentEarnAutodepositState> {
  const recurringDelegation = args.state.target.recurringDelegation;
  if (!recurringDelegation) {
    return args.state;
  }

  const probe = await probeEarnAutodepositArtifacts({
    connection: args.connection,
    policyAccount: args.state.target.policyAccount,
    recurringDelegation,
    smartAccountsProgramId: args.smartAccountsProgramId,
  });
  const policyReady = probe.policy.exists && !probe.policy.invalidOwner;
  const delegationReady =
    probe.recurringDelegation.exists && !probe.recurringDelegation.invalidOwner;
  const hasRecordedPolicy =
    args.state.target.policySignature !== null &&
    args.state.target.policyConfirmedSlot !== null;
  const hasRecordedDelegation =
    args.state.target.recurringDelegationSignature !== null &&
    args.state.target.recurringDelegationConfirmedSlot !== null;

  if (args.state.status !== "pending" && (!policyReady || !delegationReady)) {
    const target = await markAutodepositTargetPendingDelegation({
      lifecycleStatus: policyReady
        ? "pending_delegation"
        : delegationReady
        ? "pending_policy"
        : "pending_delegation",
      policyAccount: args.state.target.policyAccount,
      settings: args.settings,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress: args.walletAddress,
    });
    return { ...args.state, status: "pending", target };
  }

  if (
    args.state.status === "pending" &&
    policyReady &&
    delegationReady &&
    hasRecordedPolicy &&
    hasRecordedDelegation
  ) {
    const target = await markAutodepositTargetActiveFromArtifacts({
      policyAccount: args.state.target.policyAccount,
      settings: args.settings,
      vaultIndex: EARN_VAULT_INDEX,
      walletAddress: args.walletAddress,
    });
    return { ...args.state, status: "active", target };
  }

  return args.state;
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
  const solanaEnv = resolveConfiguredSolanaEnv();
  const cluster = resolveConfiguredCluster(solanaEnv);
  const connection = getConnection(solanaEnv);
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
          const reconciledState = await reconcileAutodepositArtifacts({
            connection,
            settings: principal.settingsPda,
            smartAccountsProgramId: programId,
            state,
            walletAddress: principal.walletAddress,
          });
          const activatedFromPending =
            state.status === "pending" && reconciledState.status === "active";
          if (activatedFromPending) {
            try {
              const snapshotResult =
                await readEarnAutodepositBootstrapWalletBalanceSnapshot({
                  connection,
                  source: RECONCILE_BOOTSTRAP_BALANCE_SOURCE,
                  sourceCommitment:
                    RECONCILE_BOOTSTRAP_BALANCE_SOURCE_COMMITMENT,
                  target: reconciledState.target,
                });
              if (snapshotResult.status === "ok") {
                await scheduleBootstrapEarnAutodepositSweep({
                  snapshot: snapshotResult.snapshot,
                  target: reconciledState.target,
                });
              }
            } catch (error) {
              console.warn(
                "[earn-state] autodeposit bootstrap reconcile failed",
                {
                  errorMessage:
                    error instanceof Error
                      ? error.message
                      : "Unknown bootstrap reconcile error.",
                  policyAccount: reconciledState.target.policyAccount,
                  walletAddress: principal.walletAddress,
                }
              );
            }
          }

          const [depositedThisPeriodRaw, initialScheduledSweeps] =
            await Promise.all([
              sumEarnAutodepositCurrentPeriodDeposits(reconciledState.target),
              reconciledState.status !== "active"
                ? []
                : findPendingEarnAutodepositScheduledSweeps(
                    reconciledState.target
                  ),
            ]);
          let scheduledSweeps = initialScheduledSweeps;
          // Clear stale scheduled sweeps the wallet can no longer back (surplus
          // already swept or spent) so the row disappears instead of lingering
          // as a phantom "Execute now". Only runs when there's a sweep to check.
          if (scheduledSweeps.length > 0) {
            try {
              const balanceSnapshot =
                await readEarnAutodepositBootstrapWalletBalanceSnapshot({
                  connection,
                  source: RECONCILE_BOOTSTRAP_BALANCE_SOURCE,
                  sourceCommitment:
                    RECONCILE_BOOTSTRAP_BALANCE_SOURCE_COMMITMENT,
                  target: reconciledState.target,
                });
              if (balanceSnapshot.status === "ok") {
                const reconcile =
                  await reconcileStaleEarnAutodepositScheduledSweeps({
                    target: reconciledState.target,
                    walletTokenBalanceRaw: balanceSnapshot.snapshot.amountRaw,
                  });
                if (
                  reconcile.canceledSlotCount > 0 ||
                  reconcile.suppressedLotCount > 0
                ) {
                  scheduledSweeps =
                    await findPendingEarnAutodepositScheduledSweeps(
                      reconciledState.target
                    );
                }
              }
            } catch (error) {
              console.warn("[earn-state] stale sweep reconcile failed", {
                errorMessage:
                  error instanceof Error
                    ? error.message
                    : "Unknown reconcile error.",
                policyAccount: reconciledState.target.policyAccount,
                walletAddress: principal.walletAddress,
              });
            }
          }

          return {
            ...reconciledState,
            depositedThisPeriodRaw,
            scheduledSweeps,
          };
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
    policySignerPublicKey: getDeploymentPolicySignerPublicKey().toBase58(),
    settingsPda: principal.settingsPda,
    vault: {
      accountIndex: EARN_VAULT_INDEX,
      pubkey: earnVaultPda.toBase58(),
    },
  });
}
