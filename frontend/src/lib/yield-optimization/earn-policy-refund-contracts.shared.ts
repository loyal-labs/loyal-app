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

export type EarnPolicyRefundRecurringDelegation = {
  account: string;
  active: boolean;
  amountPerPeriodRaw: string | null;
  amountPulledRaw: string | null;
  authority: string | null;
  delegatee: string | null;
  delegator: string | null;
  exists: boolean;
  expiryTimestamp: string | null;
  lamports: number | null;
  lifecycleStatus: string;
  mint: string | null;
  source: "chain" | "metadata";
  status: EarnPolicyRefundRecurringDelegationStatus;
  targetActive: boolean;
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

export type EarnPolicyRefundScanResponse = {
  policies: EarnPolicyRefundScanPolicy[];
  settingsPda: string;
  vaultIndex: 1;
  vaultPubkey: string;
};

export type EarnPolicyRefundPrepareRequestBody = {
  policyAccount: string;
};

export type WireSmartAccountPreparedEarnPolicyRefund = {
  estimatedRefundLamports: number | null;
  policy: EarnPolicyRefundScanPolicy;
  prepared: WirePreparedLoyalSmartAccountsOperation;
  settingsPda: string;
  vaultIndex: 1;
};

export type EarnPolicyRefundPrepareResponse = {
  preparedRefund: WireSmartAccountPreparedEarnPolicyRefund;
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
