import type { SmartAccountPreparedEarnUsdcDeposit } from "@loyal-labs/smart-account-vaults";

export type EarnDepositReviewStage = "deposit" | "policy" | "policy-finalize";

export type EarnDepositPolicySignatureSource = {
  account: string;
  lastSeenSignature?: string | null;
  lastSeenSlot?: string | null;
  seed: string;
} | null;

export type EarnDepositPolicySignatureResolution =
  | {
      policyConfirmedSlot?: string;
      policySignature: string;
      setupPolicyConfirmedSlot?: string;
      setupPolicySignature?: string;
    }
  | { error: string };

export function getEarnDepositReviewStages(args: {
  preparedDeposit?: SmartAccountPreparedEarnUsdcDeposit | null;
  requiresPolicySetup?: boolean;
}): EarnDepositReviewStage[] {
  const preparedDeposit = args.preparedDeposit ?? null;
  if (!preparedDeposit) {
    return args.requiresPolicySetup ? ["policy", "deposit"] : ["deposit"];
  }

  return [
    ...(preparedDeposit.policySetupPrepared ? (["policy"] as const) : []),
    ...(preparedDeposit.policyFinalizePrepared
      ? (["policy-finalize"] as const)
      : []),
    "deposit",
  ];
}

export function getFirstEarnDepositReviewStage(args: {
  preparedDeposit?: SmartAccountPreparedEarnUsdcDeposit | null;
  requiresPolicySetup?: boolean;
}): EarnDepositReviewStage {
  return getEarnDepositReviewStages(args)[0] ?? "deposit";
}

export function getNextEarnDepositReviewStage(args: {
  currentStage: EarnDepositReviewStage;
  preparedDeposit?: SmartAccountPreparedEarnUsdcDeposit | null;
  requiresPolicySetup?: boolean;
}): EarnDepositReviewStage | null {
  const stages = getEarnDepositReviewStages(args);
  const index = stages.indexOf(args.currentStage);
  if (index < 0) {
    return stages[0] ?? null;
  }

  return stages[index + 1] ?? null;
}

export function getEarnDepositReviewStagePosition(args: {
  stage: EarnDepositReviewStage;
  preparedDeposit?: SmartAccountPreparedEarnUsdcDeposit | null;
  requiresPolicySetup?: boolean;
}): { index: number; total: number } {
  const stages = getEarnDepositReviewStages(args);
  const index = stages.indexOf(args.stage);

  return {
    index: index >= 0 ? index + 1 : 1,
    total: stages.length || 1,
  };
}

export function resolveEarnDepositConfirmPolicySignature(args: {
  activePolicy?: EarnDepositPolicySignatureSource;
  policyConfirmedSlot?: string | null;
  policySignature?: string | null;
  preparedDeposit: SmartAccountPreparedEarnUsdcDeposit;
  setupPolicyConfirmedSlot?: string | null;
  setupPolicySignature?: string | null;
}): EarnDepositPolicySignatureResolution {
  const provided = args.policySignature?.trim();
  const providedPolicyConfirmedSlot = args.policyConfirmedSlot?.trim();
  const providedSetup = args.setupPolicySignature?.trim();
  const providedSetupConfirmedSlot = args.setupPolicyConfirmedSlot?.trim();
  if (provided) {
    const requiresPolicySetup = Boolean(
      args.preparedDeposit.policySetupPrepared
    );
    const requiresSetupPolicySetup = Boolean(
      args.preparedDeposit.policyFinalizePrepared
    );

    if (requiresPolicySetup && !providedPolicyConfirmedSlot) {
      return {
        error:
          "Confirming this first Earn deposit requires the policy setup slot. Review the deposit again before signing.",
      };
    }

    if (
      requiresSetupPolicySetup &&
      (!providedSetup || !providedSetupConfirmedSlot)
    ) {
      return {
        error:
          "Confirming this first Earn deposit requires the setup policy signature. Review the deposit again before signing.",
      };
    }

    return {
      policySignature: provided,
      ...(providedPolicyConfirmedSlot
        ? { policyConfirmedSlot: providedPolicyConfirmedSlot }
        : {}),
      ...(providedSetup ? { setupPolicySignature: providedSetup } : {}),
      ...(providedSetupConfirmedSlot
        ? { setupPolicyConfirmedSlot: providedSetupConfirmedSlot }
        : {}),
    };
  }

  const initializesPolicy =
    args.preparedDeposit.persistence.policyInitialization === "create" ||
    Boolean(args.preparedDeposit.policySetupPrepared) ||
    Boolean(args.preparedDeposit.policyFinalizePrepared);

  if (initializesPolicy) {
    return {
      error:
        "Confirming this first Earn deposit requires the policy setup signature. Review the deposit again before signing.",
    };
  }

  const policyAccount = args.preparedDeposit.policy.account.toBase58();
  const policySeed = args.preparedDeposit.policy.seed.toString();
  const activePolicy = args.activePolicy ?? null;
  if (
    activePolicy?.account === policyAccount &&
    activePolicy.seed === policySeed &&
    activePolicy.lastSeenSignature
  ) {
    return {
      policySignature: activePolicy.lastSeenSignature,
      ...(activePolicy.lastSeenSlot
        ? { policyConfirmedSlot: activePolicy.lastSeenSlot }
        : {}),
    };
  }

  return {
    error:
      "Confirming this Earn top-up requires the active policy signature. Refresh Earn and try again.",
  };
}
