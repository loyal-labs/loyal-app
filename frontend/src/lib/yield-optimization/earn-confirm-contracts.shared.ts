import type {
  SmartAccountPreparedEarnUsdcDeposit,
  SmartAccountPreparedEarnUsdcWithdraw,
  SmartAccountPreparedEarnUsdcYieldRoutingPolicy,
} from "@loyal-labs/smart-account-vaults";

import type {
  ConfirmedYieldDepositInput,
  ConfirmedYieldRoutePolicyInput,
  ConfirmedYieldWithdrawalInput,
} from "./yield-deposit-repository.server";

export type EarnPolicyConfirmRequestBody = {
  cluster: string;
  confirmedSlot: string;
  delegatedSigner: string;
  liquidityMint: string;
  market: string | null;
  policyAccount: string;
  policyId: string;
  policySeed: string;
  policySignature: string;
  settings: string;
  targetReserve: string;
  vaultIndex: number;
  vaultPubkey: string;
  walletAddress: string;
};

export type EarnDepositConfirmRequestBody = {
  cluster: string;
  confirmedSlot: string;
  delegatedSigner: string;
  depositMint: string;
  depositSignature: string;
  liquidityMint: string;
  market: string | null;
  policyAccount: string;
  policyId: string;
  policyInitialization: "create" | "reuse";
  policySeed: string;
  policySignature: string;
  principalAmountRaw: string;
  settings: string;
  smartAccountAddress: string;
  targetReserve: string;
  targetSupplyApyBps: string | null;
  vaultIndex: number;
  vaultPubkey: string;
  walletAddress: string;
};

export type EarnWithdrawalAutodepositCloseConfirmRequestBody = {
  closeSignature: string;
  confirmedSlot: string;
  delegatedSigner: string;
  policyAccount: string;
  recurringDelegation: string;
};

export type EarnWithdrawalConfirmRequestBody = {
  autodepositClose?: EarnWithdrawalAutodepositCloseConfirmRequestBody | null;
  cluster: string;
  confirmedSlot: string;
  delegatedSigner: string;
  liquidityMint: string;
  market: string | null;
  mode: "partial" | "full";
  policyAccount: string;
  policyId: string;
  policySeed: string;
  settings: string;
  smartAccountAddress: string;
  targetReserve: string;
  vaultIndex: number;
  vaultPubkey: string;
  walletAddress: string;
  withdrawalSignature: string;
  withdrawnAmountRaw: string;
};

type EarnConfirmRequestRecord = Record<string, unknown>;

function assertRequestObject(body: unknown): EarnConfirmRequestRecord {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object.");
  }

  return body as EarnConfirmRequestRecord;
}

function readRequiredString(
  body: EarnConfirmRequestRecord,
  key: string
): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value.trim();
}

function readOptionalString(
  body: EarnConfirmRequestRecord,
  key: string
): string | null {
  const value = body[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string when provided.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBigIntString(body: EarnConfirmRequestRecord, key: string): bigint {
  const value = readRequiredString(body, key);
  if (!/^\d+$/.test(value)) {
    throw new Error(`${key} must be an unsigned integer string.`);
  }
  return BigInt(value);
}

function readOptionalBigIntString(
  body: EarnConfirmRequestRecord,
  key: string
): bigint | null {
  const value = readOptionalString(body, key);
  if (value === null) {
    return null;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${key} must be an unsigned integer string.`);
  }
  return BigInt(value);
}

function readVaultIndex(body: EarnConfirmRequestRecord): number {
  const value = body.vaultIndex;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 32767
  ) {
    throw new Error("vaultIndex must be an integer between 0 and 32767.");
  }
  return value;
}

function readPolicyInitialization(
  body: EarnConfirmRequestRecord
): "create" | "reuse" {
  const value = readRequiredString(body, "policyInitialization");
  if (value !== "create" && value !== "reuse") {
    throw new Error("policyInitialization must be create or reuse.");
  }
  return value;
}

function readMode(body: EarnConfirmRequestRecord): "partial" | "full" {
  const mode = readRequiredString(body, "mode");
  if (mode !== "partial" && mode !== "full") {
    throw new Error("mode must be partial or full.");
  }
  return mode;
}

function readOptionalAutodepositClose(
  body: EarnConfirmRequestRecord
): NonNullable<ConfirmedYieldWithdrawalInput["autodepositClose"]> | null {
  const value = body.autodepositClose;
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object") {
    throw new Error("autodepositClose must be an object when provided.");
  }

  const record = value as EarnConfirmRequestRecord;
  return {
    closeSignature: readRequiredString(record, "closeSignature"),
    confirmedSlot: readBigIntString(record, "confirmedSlot"),
    delegatedSigner: readRequiredString(record, "delegatedSigner"),
    policyAccount: readRequiredString(record, "policyAccount"),
    recurringDelegation: readRequiredString(record, "recurringDelegation"),
  };
}

export function buildEarnPolicyConfirmRequestBody({
  confirmedSlot,
  preparedPolicy,
  signature,
}: {
  preparedPolicy: SmartAccountPreparedEarnUsdcYieldRoutingPolicy;
  signature: string;
  confirmedSlot: string;
}): EarnPolicyConfirmRequestBody {
  return {
    ...preparedPolicy.persistence,
    policySignature: signature,
    confirmedSlot,
  };
}

export function buildEarnDepositConfirmRequestBody({
  confirmedSlot,
  policySignature,
  preparedDeposit,
  signature,
  smartAccountAddress,
}: {
  preparedDeposit: SmartAccountPreparedEarnUsdcDeposit;
  signature: string;
  confirmedSlot: string;
  smartAccountAddress: string;
  policySignature?: string;
}): EarnDepositConfirmRequestBody {
  return {
    ...preparedDeposit.persistence,
    smartAccountAddress,
    policySignature: policySignature ?? signature,
    depositSignature: signature,
    confirmedSlot,
  };
}

export function buildEarnWithdrawalConfirmRequestBody({
  autodepositCloseConfirmedSlot,
  autodepositCloseSignature,
  confirmedSlot,
  preparedWithdraw,
  signature,
  smartAccountAddress,
}: {
  preparedWithdraw: SmartAccountPreparedEarnUsdcWithdraw;
  signature: string;
  confirmedSlot: string;
  smartAccountAddress: string;
  autodepositCloseSignature?: string;
  autodepositCloseConfirmedSlot?: string;
}): EarnWithdrawalConfirmRequestBody {
  const { autodepositClose, ...persistence } = preparedWithdraw.persistence;

  return {
    ...persistence,
    ...(autodepositClose
      ? {
          autodepositClose: {
            ...autodepositClose,
            closeSignature: autodepositCloseSignature ?? signature,
            confirmedSlot: autodepositCloseConfirmedSlot ?? confirmedSlot,
          },
        }
      : {}),
    smartAccountAddress,
    withdrawalSignature: signature,
    confirmedSlot,
  };
}

export function parseEarnPolicyConfirmRequestBody(
  body: unknown
): ConfirmedYieldRoutePolicyInput {
  const record = assertRequestObject(body);
  return {
    cluster: readRequiredString(record, "cluster"),
    confirmedSlot: readBigIntString(record, "confirmedSlot"),
    delegatedSigner: readRequiredString(record, "delegatedSigner"),
    liquidityMint: readRequiredString(record, "liquidityMint"),
    market: readOptionalString(record, "market"),
    policyAccount: readRequiredString(record, "policyAccount"),
    policyId: readBigIntString(record, "policyId"),
    policySeed: readBigIntString(record, "policySeed"),
    policySignature: readRequiredString(record, "policySignature"),
    settings: readRequiredString(record, "settings"),
    targetReserve: readRequiredString(record, "targetReserve"),
    vaultIndex: readVaultIndex(record),
    vaultPubkey: readRequiredString(record, "vaultPubkey"),
    walletAddress: readRequiredString(record, "walletAddress"),
  };
}

export function parseEarnDepositConfirmRequestBody(
  body: unknown
): ConfirmedYieldDepositInput {
  const record = assertRequestObject(body);
  return {
    cluster: readRequiredString(record, "cluster"),
    confirmedSlot: readBigIntString(record, "confirmedSlot"),
    delegatedSigner: readRequiredString(record, "delegatedSigner"),
    depositMint: readRequiredString(record, "depositMint"),
    depositSignature: readRequiredString(record, "depositSignature"),
    liquidityMint: readRequiredString(record, "liquidityMint"),
    market: readOptionalString(record, "market"),
    policyAccount: readRequiredString(record, "policyAccount"),
    policyId: readBigIntString(record, "policyId"),
    policyInitialization: readPolicyInitialization(record),
    policySeed: readBigIntString(record, "policySeed"),
    policySignature: readRequiredString(record, "policySignature"),
    principalAmountRaw: readBigIntString(record, "principalAmountRaw"),
    settings: readRequiredString(record, "settings"),
    smartAccountAddress: readRequiredString(record, "smartAccountAddress"),
    targetReserve: readRequiredString(record, "targetReserve"),
    targetSupplyApyBps: readOptionalBigIntString(record, "targetSupplyApyBps"),
    vaultIndex: readVaultIndex(record),
    vaultPubkey: readRequiredString(record, "vaultPubkey"),
    walletAddress: readRequiredString(record, "walletAddress"),
  };
}

export function parseEarnWithdrawalConfirmRequestBody(
  body: unknown
): ConfirmedYieldWithdrawalInput {
  const record = assertRequestObject(body);
  const autodepositClose = readOptionalAutodepositClose(record);
  return {
    ...(autodepositClose ? { autodepositClose } : {}),
    cluster: readRequiredString(record, "cluster"),
    confirmedSlot: readBigIntString(record, "confirmedSlot"),
    delegatedSigner: readRequiredString(record, "delegatedSigner"),
    liquidityMint: readRequiredString(record, "liquidityMint"),
    market: readOptionalString(record, "market"),
    mode: readMode(record),
    policyAccount: readRequiredString(record, "policyAccount"),
    policyId: readBigIntString(record, "policyId"),
    policySeed: readBigIntString(record, "policySeed"),
    settings: readRequiredString(record, "settings"),
    smartAccountAddress: readRequiredString(record, "smartAccountAddress"),
    targetReserve: readRequiredString(record, "targetReserve"),
    vaultIndex: readVaultIndex(record),
    vaultPubkey: readRequiredString(record, "vaultPubkey"),
    walletAddress: readRequiredString(record, "walletAddress"),
    withdrawalSignature: readRequiredString(record, "withdrawalSignature"),
    withdrawnAmountRaw: readBigIntString(record, "withdrawnAmountRaw"),
  };
}
