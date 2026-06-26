import type {
  CurrentEarnAutodepositState,
  PendingEarnAutodepositScheduledSweepRecord,
} from "./earn-autodeposit-repository.server";
import type {
  EarnDepositOnboardingAttemptRecord,
  EarnDepositOnboardingNextStep,
  RoutePolicyRecord,
} from "./yield-deposit-repository.server";

export type CurrentEarnAutodepositStateWithProgress =
  CurrentEarnAutodepositState & {
    depositedThisPeriodRaw: bigint;
    scheduledSweeps: PendingEarnAutodepositScheduledSweepRecord[];
  };

function serializeScheduledSweep(
  sweep: PendingEarnAutodepositScheduledSweepRecord
) {
  return {
    classification: sweep.classification,
    confidence: sweep.confidence,
    eligibleAfter: sweep.eligibleAfter.toISOString(),
    id: sweep.id.toString(),
    originalAmountRaw: sweep.originalAmountRaw.toString(),
    reason: sweep.reason,
    remainingAmountRaw: sweep.remainingAmountRaw.toString(),
    status: sweep.status,
  };
}

export function serializeAutodepositState(
  autodeposit: CurrentEarnAutodepositStateWithProgress
) {
  const delegatedSigner =
    autodeposit.target.delegatedSigners[0] ??
    autodeposit.policy.delegatedSigners[0] ??
    null;

  return {
    active: autodeposit.target.active,
    amountPerPeriodRaw: autodeposit.target.maxAmountPerPeriod.toString(),
    balanceSweepPolicyId:
      autodeposit.target.balanceSweepPolicyId?.toString() ??
      autodeposit.policy.id.toString(),
    cluster: autodeposit.target.cluster,
    delegatedSigner,
    depositedThisPeriodRaw: autodeposit.depositedThisPeriodRaw.toString(),
    expiryTimestamp:
      autodeposit.target.recurringDelegationExpiryTimestamp?.toString() ?? null,
    lastSeenSignature: autodeposit.target.lastSeenSignature,
    lastSeenSlot: autodeposit.target.lastSeenSlot.toString(),
    nonce: autodeposit.target.recurringDelegationNonce?.toString() ?? null,
    periodLengthSeconds:
      autodeposit.target.periodLengthSeconds?.toString() ?? null,
    policyAccount: autodeposit.policy.policyAccount,
    policyConfirmedSlot:
      autodeposit.target.policyConfirmedSlot?.toString() ?? null,
    policySeed: autodeposit.policy.policySeed.toString(),
    policySignature: autodeposit.target.policySignature,
    recurringDelegation: autodeposit.target.recurringDelegation,
    recurringDelegationConfirmedSlot:
      autodeposit.target.recurringDelegationConfirmedSlot?.toString() ?? null,
    recurringDelegationSignature:
      autodeposit.target.recurringDelegationSignature,
    scheduledSweeps: (autodeposit.scheduledSweeps ?? []).map(
      serializeScheduledSweep
    ),
    startTimestamp:
      autodeposit.target.startTimestamp?.toString() ??
      Math.floor(autodeposit.target.firstSeenAt.getTime() / 1000).toString(),
    status: autodeposit.status,
    subscriptionAuthority:
      autodeposit.target.subscriptionAuthority ??
      autodeposit.policy.subscriptionAuthority,
    subscriptionDelegatee: autodeposit.policy.subscriptionDelegatee,
    vaultUsdcAta: autodeposit.target.vaultUsdcAta,
    walletBalanceFloorRaw:
      autodeposit.target.walletBalanceFloorRaw?.toString() ?? null,
    walletUsdcAta: autodeposit.target.walletUsdcAta,
  };
}

export function serializeRoutePolicyState(
  policy: RoutePolicyRecord,
  setupPolicy: RoutePolicyRecord | null = null
) {
  return {
    account: policy.policyAccount,
    delegatedSigners: policy.delegatedSigners,
    id: policy.id.toString(),
    kaminoLiquidityMints: policy.kaminoLiquidityMints,
    kaminoMarkets: policy.kaminoMarkets,
    lastSeenSignature: policy.lastSeenSignature,
    lastSeenSlot: policy.lastSeenSlot.toString(),
    riskProfile: policy.riskProfile,
    routeModes: policy.routeModes,
    seed: policy.policySeed.toString(),
    setupPolicy: setupPolicy
      ? {
          account: setupPolicy.policyAccount,
          delegatedSigners: setupPolicy.delegatedSigners,
          id: setupPolicy.id.toString(),
          lastSeenSignature: setupPolicy.lastSeenSignature,
          lastSeenSlot: setupPolicy.lastSeenSlot.toString(),
          seed: setupPolicy.policySeed.toString(),
        }
      : null,
    stableMints: policy.stableMints,
    universePreset: policy.universePreset,
    vaultIndex: policy.vaultIndex,
    vaultPubkey: policy.vaultPubkey,
  };
}

export function serializeEarnDepositOnboardingState(args: {
  attempt: EarnDepositOnboardingAttemptRecord | null;
  nextStep: EarnDepositOnboardingNextStep;
}) {
  const { attempt, nextStep } = args;

  return {
    nextStep,
    ...(attempt
      ? {
          depositConfirmedSlot:
            attempt.depositConfirmedSlot?.toString() ?? null,
          depositSignature: attempt.depositSignature,
          lastErrorCode: attempt.lastErrorCode,
          policy: {
            account: attempt.policyAccount,
            id: attempt.policyId.toString(),
            lastSeenSignature: attempt.routePolicySignature,
            lastSeenSlot: attempt.routePolicyConfirmedSlot?.toString() ?? null,
            seed: attempt.policySeed.toString(),
          },
          setupPolicy:
            attempt.setupPolicyAccount && attempt.setupPolicySeed
              ? {
                  account: attempt.setupPolicyAccount,
                  id:
                    attempt.setupPolicyId?.toString() ??
                    attempt.setupPolicySeed.toString(),
                  lastSeenSignature: attempt.setupPolicySignature,
                  lastSeenSlot:
                    attempt.setupPolicyConfirmedSlot?.toString() ?? null,
                  seed: attempt.setupPolicySeed.toString(),
                }
              : null,
          status: attempt.status,
          updatedAt: attempt.updatedAt.toISOString(),
        }
      : {}),
  };
}
