import type {
  SmartAccountEarnUsdcAutodepositCloseMetadata,
  SmartAccountEarnUsdcAutodepositSetupMetadata,
  SmartAccountNativeSolRequirement,
  SmartAccountPreparedEarnUsdcAutodepositClose,
  SmartAccountPreparedEarnUsdcAutodepositSetup,
} from "@loyal-labs/smart-account-vaults";
import { PublicKey } from "@solana/web3.js";

import {
  hydratePreparedOperation,
  serializePreparedOperation,
  type WirePreparedLoyalSmartAccountsOperation,
} from "@/lib/smart-accounts/prepared-operation-wire.shared";

export type EarnAutodepositSetupPrepareRequestBody = {
  amountRaw: string;
  expiryTimestamp?: string;
  includeBatch?: boolean;
  nonce?: string;
  periodLengthSeconds?: string;
  policySeed?: string;
  startTimestamp?: string;
  walletBalanceFloorRaw?: string;
};

export type EarnAutodepositSetupStage =
  | "initialize_subscription_authority"
  | "create_policy"
  | "create_recurring_delegation";

export type ConfirmedEarnAutodepositSetupInput = {
  amountPerPeriodRaw: bigint;
  cluster: string;
  confirmedSlot: bigint;
  delegatedSigner: string;
  expiryTimestamp: bigint;
  liquidityMint: string;
  nonce: bigint;
  periodLengthSeconds: bigint;
  policyAccount: string;
  policyId: bigint;
  policySeed: bigint;
  recurringDelegation: string;
  settings: string;
  setupSignature: string;
  setupStage: EarnAutodepositSetupStage;
  startTimestamp: bigint;
  subscriptionAuthority: string;
  subscriptionAuthorityInitialization: "exists" | "required";
  subscriptionDelegatee: string;
  vaultIndex: 1;
  vaultPubkey: string;
  vaultUsdcAta: string;
  walletAddress: string;
  walletBalanceFloorRaw: bigint;
  walletUsdcAta: string;
};

export type ConfirmedEarnAutodepositCloseInput = {
  cluster: string;
  closeSignature: string;
  confirmedSlot: bigint;
  delegatedSigner: string;
  policyAccount: string;
  recurringDelegation: string;
  settings: string;
  vaultIndex: 1;
  vaultPubkey: string;
  walletAddress: string;
};

export type EarnAutodepositClosePrepareRequestBody = {
  policy: string;
  recurringDelegation: string;
};

export type EarnAutodepositFloorUpdateConfirmRequestBody = {
  policyAccount: string;
  recurringDelegation: string;
  vaultIndex: 1;
  walletBalanceFloorRaw: string;
};

export type EarnAutodepositToggleConfirmRequestBody = {
  active: boolean;
  policyAccount: string;
  recurringDelegation: string;
  vaultIndex: 1;
};

export type EarnAutodepositSetupConfirmRequestBody = {
  amountPerPeriodRaw: string;
  cluster: string;
  confirmedSlot: string;
  delegatedSigner: string;
  expiryTimestamp: string;
  liquidityMint: string;
  nonce: string;
  periodLengthSeconds: string;
  policyAccount: string;
  policyId: string;
  policySeed: string;
  recurringDelegation: string;
  settings: string;
  setupSignature: string;
  setupStage: EarnAutodepositSetupStage;
  startTimestamp: string;
  subscriptionAuthority: string;
  subscriptionAuthorityInitialization: "exists" | "required";
  subscriptionDelegatee: string;
  vaultIndex: 1;
  vaultPubkey: string;
  vaultUsdcAta: string;
  walletAddress: string;
  walletBalanceFloorRaw: string;
  walletUsdcAta: string;
};

export type EarnAutodepositCloseConfirmRequestBody = {
  cluster: string;
  closeSignature: string;
  confirmedSlot: string;
  delegatedSigner: string;
  policyAccount: string;
  recurringDelegation: string;
  settings: string;
  vaultIndex: 1;
  vaultPubkey: string;
  walletAddress: string;
};

export type WireSmartAccountPreparedEarnUsdcAutodepositSetup = {
  authorityInitializationRequired: boolean;
  nativeSolRequirement: SmartAccountNativeSolRequirement;
  persistence: SmartAccountEarnUsdcAutodepositSetupMetadata;
  policy: {
    account: string | null;
    id: string | null;
    seed: string | null;
  };
  prepared: WirePreparedLoyalSmartAccountsOperation;
  stage: SmartAccountPreparedEarnUsdcAutodepositSetup["stage"];
  subscription: {
    amountPerPeriodRaw: string;
    authority: string;
    expiryTimestamp: string;
    nonce: string;
    periodLengthSeconds: string;
    recurringDelegation: string;
    startTimestamp: string;
  };
  vault: {
    accountIndex: 1;
    pubkey: string;
    usdcAta: string;
  };
};

export type WireSmartAccountPreparedEarnUsdcAutodepositClose = {
  persistence: SmartAccountEarnUsdcAutodepositCloseMetadata;
  policy: {
    account: string;
  };
  prepared: WirePreparedLoyalSmartAccountsOperation;
  subscription: {
    recurringDelegation: string;
  };
  vault: {
    accountIndex: 1;
    pubkey: string;
  };
};

export type EarnAutodepositSetupPrepareResponse = {
  nextPreparedSetup?: WireSmartAccountPreparedEarnUsdcAutodepositSetup | null;
  preparedSetup: WireSmartAccountPreparedEarnUsdcAutodepositSetup;
};

export type EarnAutodepositClosePrepareResponse = {
  preparedClose: WireSmartAccountPreparedEarnUsdcAutodepositClose;
};

export type EarnAutodepositSetupConfirmResponse = {
  confirmedSlot?: string;
  bootstrapSweep?: {
    reason?: string;
    status: "already_exists" | "failed" | "scheduled" | "skipped";
    sweep?: {
      classification: string;
      confidence: string;
      eligibleAfter: string;
      executeNowAvailableAt?: string | null;
      id: string;
      lotCount?: number;
      originalAmountRaw: string;
      reason: string;
      remainingAmountRaw: string;
      slotId?: string;
      status: string;
    };
  };
  rebaselineSweep?: {
    reason?: string;
    status: "failed" | "scheduled" | "skipped";
    sweep?: {
      classification: string;
      confidence: string;
      eligibleAfter: string;
      executeNowAvailableAt?: string | null;
      id: string;
      lotCount?: number;
      originalAmountRaw: string;
      reason: string;
      remainingAmountRaw: string;
      slotId?: string;
      status: string;
    };
  };
  target?: {
    active: boolean;
    balanceSweepPolicyId: string | null;
    id: string;
    lifecycleStatus: string;
    policyAccount: string;
    recurringDelegation: string | null;
    walletBalanceFloorRaw: string | null;
  };
};

export type EarnAutodepositCloseConfirmResponse =
  EarnAutodepositSetupConfirmResponse;

export type EarnAutodepositToggleConfirmResponse =
  EarnAutodepositSetupConfirmResponse;

type EarnAutodepositPrepareRecord = Record<string, unknown>;

function assertRequestObject(body: unknown): EarnAutodepositPrepareRecord {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object.");
  }
  return body as EarnAutodepositPrepareRecord;
}

function readUnsignedIntegerString(
  body: EarnAutodepositPrepareRecord,
  key: string
): string {
  const value = body[key];
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    throw new Error(`${key} must be an unsigned integer string.`);
  }
  return value.trim();
}

function readOptionalUnsignedIntegerString(
  body: EarnAutodepositPrepareRecord,
  key: string
): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    throw new Error(`${key} must be an unsigned integer string when provided.`);
  }
  return value.trim();
}

function readRequiredString(
  body: EarnAutodepositPrepareRecord,
  key: string
): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value.trim();
}

function readBigIntString(
  body: EarnAutodepositPrepareRecord,
  key: string
): bigint {
  const value = readUnsignedIntegerString(body, key);
  return BigInt(value);
}

function readRequiredBoolean(
  body: EarnAutodepositPrepareRecord,
  key: string
): boolean {
  const value = body[key];
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean.`);
  }
  return value;
}

function readVaultIndex(body: EarnAutodepositPrepareRecord): 1 {
  const value = body.vaultIndex;
  if (value !== 1) {
    throw new Error("vaultIndex must be 1 for Earn autodeposit.");
  }
  return value;
}

function readSetupStage(
  body: EarnAutodepositPrepareRecord
): EarnAutodepositSetupStage {
  const value = readRequiredString(body, "setupStage");
  if (
    value !== "initialize_subscription_authority" &&
    value !== "create_policy" &&
    value !== "create_recurring_delegation"
  ) {
    throw new Error("setupStage is not a supported autodeposit stage.");
  }
  return value;
}

function readSubscriptionAuthorityInitialization(
  body: EarnAutodepositPrepareRecord
): "exists" | "required" {
  const value = readRequiredString(body, "subscriptionAuthorityInitialization");
  if (value !== "exists" && value !== "required") {
    throw new Error(
      "subscriptionAuthorityInitialization must be exists or required."
    );
  }
  return value;
}

function requirePreparedMetadataValue(
  value: string | null,
  key: string
): string {
  if (!value) {
    throw new Error(`prepared autodeposit metadata is missing ${key}.`);
  }
  return value;
}

export function parseEarnAutodepositSetupPrepareRequestBody(body: unknown): {
  amountRaw: bigint;
  expiryTimestamp?: bigint;
  includeBatch: boolean;
  nonce?: bigint;
  periodLengthSeconds?: bigint;
  policySeed?: bigint;
  startTimestamp?: bigint;
  walletBalanceFloorRaw?: bigint;
} {
  const record = assertRequestObject(body);
  const amountRaw = BigInt(readUnsignedIntegerString(record, "amountRaw"));
  const expiryTimestamp = readOptionalUnsignedIntegerString(
    record,
    "expiryTimestamp"
  );
  const includeBatchValue = record.includeBatch;
  const nonce = readOptionalUnsignedIntegerString(record, "nonce");
  const periodLengthSeconds = readOptionalUnsignedIntegerString(
    record,
    "periodLengthSeconds"
  );
  const policySeed = readOptionalUnsignedIntegerString(record, "policySeed");
  const startTimestamp = readOptionalUnsignedIntegerString(
    record,
    "startTimestamp"
  );
  const walletBalanceFloorRaw = readOptionalUnsignedIntegerString(
    record,
    "walletBalanceFloorRaw"
  );
  if (
    includeBatchValue !== undefined &&
    includeBatchValue !== null &&
    typeof includeBatchValue !== "boolean"
  ) {
    throw new Error("includeBatch must be a boolean when provided.");
  }

  if (amountRaw <= BigInt(0)) {
    throw new Error("amountRaw must be greater than 0.");
  }

  return {
    amountRaw,
    ...(expiryTimestamp ? { expiryTimestamp: BigInt(expiryTimestamp) } : {}),
    includeBatch:
      includeBatchValue === undefined || includeBatchValue === null
        ? false
        : includeBatchValue === true,
    ...(nonce ? { nonce: BigInt(nonce) } : {}),
    ...(periodLengthSeconds
      ? { periodLengthSeconds: BigInt(periodLengthSeconds) }
      : {}),
    ...(policySeed ? { policySeed: BigInt(policySeed) } : {}),
    ...(startTimestamp ? { startTimestamp: BigInt(startTimestamp) } : {}),
    ...(walletBalanceFloorRaw
      ? { walletBalanceFloorRaw: BigInt(walletBalanceFloorRaw) }
      : {}),
  };
}

export function parseEarnAutodepositClosePrepareRequestBody(body: unknown): {
  policy: string;
  recurringDelegation: string;
} {
  const record = assertRequestObject(body);
  return {
    policy: readRequiredString(record, "policy"),
    recurringDelegation: readRequiredString(record, "recurringDelegation"),
  };
}

export function parseEarnAutodepositFloorUpdateConfirmRequestBody(
  body: unknown
): {
  policyAccount: string;
  recurringDelegation: string;
  vaultIndex: 1;
  walletBalanceFloorRaw: bigint;
} {
  const record = assertRequestObject(body);
  return {
    policyAccount: readRequiredString(record, "policyAccount"),
    recurringDelegation: readRequiredString(record, "recurringDelegation"),
    vaultIndex: readVaultIndex(record),
    walletBalanceFloorRaw: readBigIntString(record, "walletBalanceFloorRaw"),
  };
}

export function parseEarnAutodepositToggleConfirmRequestBody(body: unknown): {
  active: boolean;
  policyAccount: string;
  recurringDelegation: string;
  vaultIndex: 1;
} {
  const record = assertRequestObject(body);
  return {
    active: readRequiredBoolean(record, "active"),
    policyAccount: readRequiredString(record, "policyAccount"),
    recurringDelegation: readRequiredString(record, "recurringDelegation"),
    vaultIndex: readVaultIndex(record),
  };
}

export function buildEarnAutodepositSetupConfirmRequestBody({
  confirmedSlot,
  preparedSetup,
  signature,
  walletBalanceFloorRaw,
}: {
  confirmedSlot: string;
  preparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup;
  signature: string;
  walletBalanceFloorRaw: bigint;
}): EarnAutodepositSetupConfirmRequestBody {
  const persistence = preparedSetup.persistence;
  return {
    amountPerPeriodRaw: persistence.amountPerPeriodRaw,
    cluster: persistence.cluster,
    confirmedSlot,
    delegatedSigner: persistence.delegatedSigner,
    expiryTimestamp: persistence.expiryTimestamp,
    liquidityMint: persistence.liquidityMint,
    nonce: persistence.nonce,
    periodLengthSeconds: persistence.periodLengthSeconds,
    policyAccount: requirePreparedMetadataValue(
      persistence.policyAccount,
      "policyAccount"
    ),
    policyId: requirePreparedMetadataValue(persistence.policyId, "policyId"),
    policySeed: requirePreparedMetadataValue(
      persistence.policySeed,
      "policySeed"
    ),
    recurringDelegation: persistence.recurringDelegation,
    settings: persistence.settings,
    setupSignature: signature,
    setupStage: preparedSetup.stage,
    startTimestamp: persistence.startTimestamp,
    subscriptionAuthority: persistence.subscriptionAuthority,
    subscriptionAuthorityInitialization:
      persistence.subscriptionAuthorityInitialization,
    subscriptionDelegatee: persistence.subscriptionDelegatee,
    vaultIndex: persistence.vaultIndex,
    vaultPubkey: persistence.vaultPubkey,
    vaultUsdcAta: persistence.vaultUsdcAta,
    walletAddress: persistence.walletAddress,
    walletBalanceFloorRaw: walletBalanceFloorRaw.toString(),
    walletUsdcAta: persistence.walletUsdcAta,
  };
}

export function buildEarnAutodepositCloseConfirmRequestBody({
  confirmedSlot,
  preparedClose,
  signature,
}: {
  confirmedSlot: string;
  preparedClose: SmartAccountPreparedEarnUsdcAutodepositClose;
  signature: string;
}): EarnAutodepositCloseConfirmRequestBody {
  return {
    ...preparedClose.persistence,
    closeSignature: signature,
    confirmedSlot,
  };
}

export function parseEarnAutodepositSetupConfirmRequestBody(
  body: unknown
): ConfirmedEarnAutodepositSetupInput {
  const record = assertRequestObject(body);
  return {
    amountPerPeriodRaw: readBigIntString(record, "amountPerPeriodRaw"),
    cluster: readRequiredString(record, "cluster"),
    confirmedSlot: readBigIntString(record, "confirmedSlot"),
    delegatedSigner: readRequiredString(record, "delegatedSigner"),
    expiryTimestamp: readBigIntString(record, "expiryTimestamp"),
    liquidityMint: readRequiredString(record, "liquidityMint"),
    nonce: readBigIntString(record, "nonce"),
    periodLengthSeconds: readBigIntString(record, "periodLengthSeconds"),
    policyAccount: readRequiredString(record, "policyAccount"),
    policyId: readBigIntString(record, "policyId"),
    policySeed: readBigIntString(record, "policySeed"),
    recurringDelegation: readRequiredString(record, "recurringDelegation"),
    settings: readRequiredString(record, "settings"),
    setupSignature: readRequiredString(record, "setupSignature"),
    setupStage: readSetupStage(record),
    startTimestamp: readBigIntString(record, "startTimestamp"),
    subscriptionAuthority: readRequiredString(record, "subscriptionAuthority"),
    subscriptionAuthorityInitialization:
      readSubscriptionAuthorityInitialization(record),
    subscriptionDelegatee: readRequiredString(record, "subscriptionDelegatee"),
    vaultIndex: readVaultIndex(record),
    vaultPubkey: readRequiredString(record, "vaultPubkey"),
    vaultUsdcAta: readRequiredString(record, "vaultUsdcAta"),
    walletAddress: readRequiredString(record, "walletAddress"),
    walletBalanceFloorRaw: readBigIntString(record, "walletBalanceFloorRaw"),
    walletUsdcAta: readRequiredString(record, "walletUsdcAta"),
  };
}

export function parseEarnAutodepositCloseConfirmRequestBody(
  body: unknown
): ConfirmedEarnAutodepositCloseInput {
  const record = assertRequestObject(body);
  return {
    cluster: readRequiredString(record, "cluster"),
    closeSignature: readRequiredString(record, "closeSignature"),
    confirmedSlot: readBigIntString(record, "confirmedSlot"),
    delegatedSigner: readRequiredString(record, "delegatedSigner"),
    policyAccount: readRequiredString(record, "policyAccount"),
    recurringDelegation: readRequiredString(record, "recurringDelegation"),
    settings: readRequiredString(record, "settings"),
    vaultIndex: readVaultIndex(record),
    vaultPubkey: readRequiredString(record, "vaultPubkey"),
    walletAddress: readRequiredString(record, "walletAddress"),
  };
}

export function serializePreparedEarnUsdcAutodepositSetup(
  preparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup
): WireSmartAccountPreparedEarnUsdcAutodepositSetup {
  return {
    authorityInitializationRequired:
      preparedSetup.authorityInitializationRequired,
    nativeSolRequirement: preparedSetup.nativeSolRequirement,
    persistence: preparedSetup.persistence,
    policy: {
      account: preparedSetup.policy.account?.toBase58() ?? null,
      id: preparedSetup.policy.id?.toString() ?? null,
      seed: preparedSetup.policy.seed?.toString() ?? null,
    },
    prepared: serializePreparedOperation(preparedSetup.prepared),
    stage: preparedSetup.stage,
    subscription: {
      amountPerPeriodRaw:
        preparedSetup.subscription.amountPerPeriodRaw.toString(),
      authority: preparedSetup.subscription.authority.toBase58(),
      expiryTimestamp: preparedSetup.subscription.expiryTimestamp.toString(),
      nonce: preparedSetup.subscription.nonce.toString(),
      periodLengthSeconds:
        preparedSetup.subscription.periodLengthSeconds.toString(),
      recurringDelegation:
        preparedSetup.subscription.recurringDelegation.toBase58(),
      startTimestamp: preparedSetup.subscription.startTimestamp.toString(),
    },
    vault: {
      accountIndex: preparedSetup.vault.accountIndex,
      pubkey: preparedSetup.vault.pubkey.toBase58(),
      usdcAta: preparedSetup.vault.usdcAta.toBase58(),
    },
  };
}

export function hydratePreparedEarnUsdcAutodepositSetup(
  wire: WireSmartAccountPreparedEarnUsdcAutodepositSetup
): SmartAccountPreparedEarnUsdcAutodepositSetup {
  return {
    authorityInitializationRequired: wire.authorityInitializationRequired,
    nativeSolRequirement: wire.nativeSolRequirement,
    persistence: wire.persistence,
    policy: {
      account: wire.policy.account ? new PublicKey(wire.policy.account) : null,
      id: wire.policy.id ? BigInt(wire.policy.id) : null,
      seed: wire.policy.seed ? BigInt(wire.policy.seed) : null,
    },
    prepared: hydratePreparedOperation(wire.prepared),
    stage: wire.stage,
    subscription: {
      amountPerPeriodRaw: BigInt(wire.subscription.amountPerPeriodRaw),
      authority: new PublicKey(wire.subscription.authority),
      expiryTimestamp: BigInt(wire.subscription.expiryTimestamp),
      nonce: BigInt(wire.subscription.nonce),
      periodLengthSeconds: BigInt(wire.subscription.periodLengthSeconds),
      recurringDelegation: new PublicKey(wire.subscription.recurringDelegation),
      startTimestamp: BigInt(wire.subscription.startTimestamp),
    },
    vault: {
      accountIndex: wire.vault.accountIndex,
      pubkey: new PublicKey(wire.vault.pubkey),
      usdcAta: new PublicKey(wire.vault.usdcAta),
    },
  };
}

export function serializePreparedEarnUsdcAutodepositClose(
  preparedClose: SmartAccountPreparedEarnUsdcAutodepositClose
): WireSmartAccountPreparedEarnUsdcAutodepositClose {
  return {
    persistence: preparedClose.persistence,
    policy: {
      account: preparedClose.policy.account.toBase58(),
    },
    prepared: serializePreparedOperation(preparedClose.prepared),
    subscription: {
      recurringDelegation:
        preparedClose.subscription.recurringDelegation.toBase58(),
    },
    vault: {
      accountIndex: preparedClose.vault.accountIndex,
      pubkey: preparedClose.vault.pubkey.toBase58(),
    },
  };
}

export function hydratePreparedEarnUsdcAutodepositClose(
  wire: WireSmartAccountPreparedEarnUsdcAutodepositClose
): SmartAccountPreparedEarnUsdcAutodepositClose {
  return {
    persistence: wire.persistence,
    policy: {
      account: new PublicKey(wire.policy.account),
    },
    prepared: hydratePreparedOperation(wire.prepared),
    subscription: {
      recurringDelegation: new PublicKey(wire.subscription.recurringDelegation),
    },
    vault: {
      accountIndex: wire.vault.accountIndex,
      pubkey: new PublicKey(wire.vault.pubkey),
    },
  };
}
