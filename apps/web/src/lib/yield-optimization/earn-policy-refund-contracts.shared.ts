import type { PreparedLoyalSmartAccountsOperation } from "@loyal-labs/loyal-smart-accounts";

import {
  hydratePreparedOperation,
  serializePreparedOperation,
  type WirePreparedLoyalSmartAccountsOperation,
} from "@/lib/smart-accounts/prepared-operation-wire.shared";

export type EarnPolicyRefundRecurringDelegationStatus =
  | "active"
  | "expired"
  | "invalid"
  | "missing"
  | "paused"
  | "pending";

export type EarnPolicyRefundRecurringDelegationUsage =
  | "current"
  | "paused"
  | "pending"
  | "scheduled"
  | "unused";

export type EarnPolicyRefundRecurringDelegation = {
  account: string;
  active: boolean;
  amountPerPeriodRaw: string | null;
  amountPulledRaw: string | null;
  authority: string | null;
  blockedReason: string | null;
  canRefund: boolean;
  delegatee: string | null;
  delegator: string | null;
  exists: boolean;
  expiryTimestamp: string | null;
  lamports: number | null;
  lifecycleStatus: string;
  mint: string | null;
  policyAccount: string | null;
  protected: boolean;
  scheduledSweepCount: number;
  source: "chain" | "metadata";
  status: EarnPolicyRefundRecurringDelegationStatus;
  targetActive: boolean;
  targetId: string | null;
  usage: EarnPolicyRefundRecurringDelegationUsage;
};

export type EarnPolicyRefundScanPolicy = {
  account: string;
  accountIndex: number | null;
  activeAutodeposit: boolean;
  activeManagedVault: boolean;
  blockedReason: string | null;
  canRefund: boolean;
  dbPresent: boolean;
  lamports: number | null;
  recurringDelegations: EarnPolicyRefundRecurringDelegation[];
  referencedByActivePosition: boolean;
  seed: string;
  state: string;
};

export type EarnVaultRefundTokenAccount = {
  account: string;
  amountRaw: string;
  isUsdc: boolean;
  lamports: number;
  mint: string;
};

// The Earn vault's own refundable rent: the SOL sitting on the vault PDA (the
// unspent Kamino setup buffer) plus the rent locked in its token accounts.
// Everything here is chain-derived, so it surfaces even when the DB rows for
// the position are long gone.
export type EarnPolicyRefundVaultEntry = {
  account: string;
  blockedReason: string | null;
  canRefund: boolean;
  lamports: number;
  tokenAccounts: EarnVaultRefundTokenAccount[];
  totalRefundableLamports: number;
};

export type EarnPolicyRefundScanResponse = {
  policies: EarnPolicyRefundScanPolicy[];
  recurringDelegations: EarnPolicyRefundRecurringDelegation[];
  settingsPda: string;
  vault: EarnPolicyRefundVaultEntry | null;
  vaultIndex: 1;
  vaultPubkey: string;
};

export type EarnPolicyRefundPrepareRequestBody =
  | {
      kind?: "policy";
      policyAccount: string;
    }
  | {
      kind: "recurring_delegation";
      recurringDelegation: string;
    }
  | {
      kind: "vault";
    };

export type WireSmartAccountPreparedEarnPolicyRefund = {
  estimatedRefundLamports: number | null;
  policy: EarnPolicyRefundScanPolicy;
  prepared: WirePreparedLoyalSmartAccountsOperation;
  settingsPda: string;
  vaultIndex: 1;
};

export type WireSmartAccountPreparedEarnRecurringDelegationRefund = {
  estimatedRefundLamports: number | null;
  prepared: WirePreparedLoyalSmartAccountsOperation;
  recurringDelegation: EarnPolicyRefundRecurringDelegation;
  settingsPda: string;
  vaultIndex: 1;
};

export type WireSmartAccountPreparedEarnVaultRefund = {
  estimatedRefundLamports: number | null;
  prepared: WirePreparedLoyalSmartAccountsOperation;
  settingsPda: string;
  vault: EarnPolicyRefundVaultEntry;
  vaultIndex: 1;
};

export type EarnPolicyRefundPrepareResponse = {
  preparedRecurringDelegationRefund?: WireSmartAccountPreparedEarnRecurringDelegationRefund;
  preparedRefund?: WireSmartAccountPreparedEarnPolicyRefund;
  preparedVaultRefund?: WireSmartAccountPreparedEarnVaultRefund;
};

function assertRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object.");
  }

  return body as Record<string, unknown>;
}

export function parseEarnPolicyRefundPrepareRequestBody(
  body: unknown
): EarnPolicyRefundPrepareRequestBody {
  const record = assertRecord(body);
  const kind = record.kind;

  if (kind === "recurring_delegation") {
    const recurringDelegation = record.recurringDelegation;
    if (
      typeof recurringDelegation !== "string" ||
      recurringDelegation.trim().length === 0
    ) {
      throw new Error("recurringDelegation must be a non-empty string.");
    }

    return {
      kind: "recurring_delegation",
      recurringDelegation: recurringDelegation.trim(),
    };
  }

  if (kind === "vault") {
    return { kind: "vault" };
  }

  if (kind !== undefined && kind !== "policy") {
    throw new Error(
      "kind must be one of policy, recurring_delegation, or vault."
    );
  }

  const policyAccount = record.policyAccount;

  if (typeof policyAccount !== "string" || policyAccount.trim().length === 0) {
    throw new Error("policyAccount must be a non-empty string.");
  }

  return { policyAccount: policyAccount.trim() };
}

export function serializePreparedEarnPolicyRefund(args: {
  estimatedRefundLamports: number | null;
  policy: EarnPolicyRefundScanPolicy;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  settingsPda: string;
  vaultIndex: 1;
}): WireSmartAccountPreparedEarnPolicyRefund {
  return {
    estimatedRefundLamports: args.estimatedRefundLamports,
    policy: args.policy,
    prepared: serializePreparedOperation(args.prepared),
    settingsPda: args.settingsPda,
    vaultIndex: args.vaultIndex,
  };
}

export function serializePreparedEarnRecurringDelegationRefund(args: {
  estimatedRefundLamports: number | null;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  recurringDelegation: EarnPolicyRefundRecurringDelegation;
  settingsPda: string;
  vaultIndex: 1;
}): WireSmartAccountPreparedEarnRecurringDelegationRefund {
  return {
    estimatedRefundLamports: args.estimatedRefundLamports,
    prepared: serializePreparedOperation(args.prepared),
    recurringDelegation: args.recurringDelegation,
    settingsPda: args.settingsPda,
    vaultIndex: args.vaultIndex,
  };
}

export function hydratePreparedEarnPolicyRefund(
  wire: WireSmartAccountPreparedEarnPolicyRefund
): {
  estimatedRefundLamports: number | null;
  policy: EarnPolicyRefundScanPolicy;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  settingsPda: string;
  vaultIndex: 1;
} {
  return {
    estimatedRefundLamports: wire.estimatedRefundLamports,
    policy: wire.policy,
    prepared: hydratePreparedOperation(wire.prepared),
    settingsPda: wire.settingsPda,
    vaultIndex: wire.vaultIndex,
  };
}

export function serializePreparedEarnVaultRefund(args: {
  estimatedRefundLamports: number | null;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  settingsPda: string;
  vault: EarnPolicyRefundVaultEntry;
  vaultIndex: 1;
}): WireSmartAccountPreparedEarnVaultRefund {
  return {
    estimatedRefundLamports: args.estimatedRefundLamports,
    prepared: serializePreparedOperation(args.prepared),
    settingsPda: args.settingsPda,
    vault: args.vault,
    vaultIndex: args.vaultIndex,
  };
}

export function hydratePreparedEarnVaultRefund(
  wire: WireSmartAccountPreparedEarnVaultRefund
): {
  estimatedRefundLamports: number | null;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  settingsPda: string;
  vault: EarnPolicyRefundVaultEntry;
  vaultIndex: 1;
} {
  return {
    estimatedRefundLamports: wire.estimatedRefundLamports,
    prepared: hydratePreparedOperation(wire.prepared),
    settingsPda: wire.settingsPda,
    vault: wire.vault,
    vaultIndex: wire.vaultIndex,
  };
}

export function hydratePreparedEarnRecurringDelegationRefund(
  wire: WireSmartAccountPreparedEarnRecurringDelegationRefund
): {
  estimatedRefundLamports: number | null;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  recurringDelegation: EarnPolicyRefundRecurringDelegation;
  settingsPda: string;
  vaultIndex: 1;
} {
  return {
    estimatedRefundLamports: wire.estimatedRefundLamports,
    prepared: hydratePreparedOperation(wire.prepared),
    recurringDelegation: wire.recurringDelegation,
    settingsPda: wire.settingsPda,
    vaultIndex: wire.vaultIndex,
  };
}
