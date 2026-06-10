import type {
  SmartAccountEarnUsdcAutodepositCloseMetadata,
  SmartAccountEarnUsdcAutodepositSetupMetadata,
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
  nonce?: string;
  policySeed?: string;
};

export type EarnAutodepositClosePrepareRequestBody = {
  policy: string;
  recurringDelegation: string;
};

export type WireSmartAccountPreparedEarnUsdcAutodepositSetup = {
  authorityInitializationRequired: boolean;
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
  preparedSetup: WireSmartAccountPreparedEarnUsdcAutodepositSetup;
};

export type EarnAutodepositClosePrepareResponse = {
  preparedClose: WireSmartAccountPreparedEarnUsdcAutodepositClose;
};

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

export function parseEarnAutodepositSetupPrepareRequestBody(
  body: unknown
): {
  amountRaw: bigint;
  nonce?: bigint;
  policySeed?: bigint;
} {
  const record = assertRequestObject(body);
  const amountRaw = BigInt(readUnsignedIntegerString(record, "amountRaw"));
  const nonce = readOptionalUnsignedIntegerString(record, "nonce");
  const policySeed = readOptionalUnsignedIntegerString(record, "policySeed");

  if (amountRaw <= BigInt(0)) {
    throw new Error("amountRaw must be greater than 0.");
  }

  return {
    amountRaw,
    ...(nonce ? { nonce: BigInt(nonce) } : {}),
    ...(policySeed ? { policySeed: BigInt(policySeed) } : {}),
  };
}

export function parseEarnAutodepositClosePrepareRequestBody(
  body: unknown
): { policy: string; recurringDelegation: string } {
  const record = assertRequestObject(body);
  return {
    policy: readRequiredString(record, "policy"),
    recurringDelegation: readRequiredString(record, "recurringDelegation"),
  };
}

export function serializePreparedEarnUsdcAutodepositSetup(
  preparedSetup: SmartAccountPreparedEarnUsdcAutodepositSetup
): WireSmartAccountPreparedEarnUsdcAutodepositSetup {
  return {
    authorityInitializationRequired:
      preparedSetup.authorityInitializationRequired,
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
