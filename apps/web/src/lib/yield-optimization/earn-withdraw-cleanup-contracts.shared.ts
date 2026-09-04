import type {
  SmartAccountEarnUsdcCleanupMetadata,
  SmartAccountPreparedEarnUsdcCleanup,
} from "@loyal-labs/smart-account-vaults";
import { PublicKey } from "@solana/web3.js";

import {
  hydratePreparedOperation,
  serializePreparedOperation,
  type WirePreparedLoyalSmartAccountsOperation,
} from "@/lib/smart-accounts/prepared-operation-wire.shared";
import {
  hydratePreparedEarnUsdcAutodepositClose,
  serializePreparedEarnUsdcAutodepositClose,
  type WireSmartAccountPreparedEarnUsdcAutodepositClose,
} from "./earn-autodeposit-prepare-contracts.shared";

export type WireSmartAccountPreparedEarnUsdcCleanup = {
  autodepositClosePrepared?: WireSmartAccountPreparedEarnUsdcAutodepositClose | null;
  estimatedRefundLamports: number | null;
  persistence: SmartAccountEarnUsdcCleanupMetadata;
  policy: {
    account: string;
    id: string;
    seed: string;
  };
  setupPolicy?: {
    account: string;
    id: string;
    seed: string;
  };
  prepared: WirePreparedLoyalSmartAccountsOperation;
  vault: {
    accountIndex: 1;
    pubkey: string;
    usdcAta: string;
  };
};

export type EarnWithdrawCleanupPrepareResponse = {
  preparedCleanup: WireSmartAccountPreparedEarnUsdcCleanup;
};

export type EarnWithdrawCleanupConfirmRequestBody = {
  autodepositCloseConfirmedSlot?: string;
  autodepositCloseSignature?: string;
  cleanupSignature: string;
  confirmedSlot: string;
  preparedCleanup: WireSmartAccountPreparedEarnUsdcCleanup;
};

export function serializePreparedEarnUsdcCleanup(args: {
  estimatedRefundLamports: number | null;
  preparedCleanup: SmartAccountPreparedEarnUsdcCleanup;
}): WireSmartAccountPreparedEarnUsdcCleanup {
  const { preparedCleanup } = args;
  return {
    autodepositClosePrepared: preparedCleanup.autodepositClosePrepared
      ? serializePreparedEarnUsdcAutodepositClose(
          preparedCleanup.autodepositClosePrepared
        )
      : null,
    estimatedRefundLamports: args.estimatedRefundLamports,
    persistence: preparedCleanup.persistence,
    policy: {
      account: preparedCleanup.policy.account.toBase58(),
      id: preparedCleanup.policy.id.toString(),
      seed: preparedCleanup.policy.seed.toString(),
    },
    ...(preparedCleanup.setupPolicy
      ? {
          setupPolicy: {
            account: preparedCleanup.setupPolicy.account.toBase58(),
            id: preparedCleanup.setupPolicy.id.toString(),
            seed: preparedCleanup.setupPolicy.seed.toString(),
          },
        }
      : {}),
    prepared: serializePreparedOperation(preparedCleanup.prepared),
    vault: {
      accountIndex: preparedCleanup.vault.accountIndex,
      pubkey: preparedCleanup.vault.pubkey.toBase58(),
      usdcAta: preparedCleanup.vault.usdcAta.toBase58(),
    },
  };
}

export function hydratePreparedEarnUsdcCleanup(
  wire: WireSmartAccountPreparedEarnUsdcCleanup
): SmartAccountPreparedEarnUsdcCleanup & {
  estimatedRefundLamports: number | null;
} {
  return {
    autodepositClosePrepared: wire.autodepositClosePrepared
      ? hydratePreparedEarnUsdcAutodepositClose(wire.autodepositClosePrepared)
      : null,
    estimatedRefundLamports: wire.estimatedRefundLamports,
    persistence: wire.persistence,
    policy: {
      account: new PublicKey(wire.policy.account),
      id: BigInt(wire.policy.id),
      seed: BigInt(wire.policy.seed),
    },
    ...(wire.setupPolicy
      ? {
          setupPolicy: {
            account: new PublicKey(wire.setupPolicy.account),
            id: BigInt(wire.setupPolicy.id),
            seed: BigInt(wire.setupPolicy.seed),
          },
        }
      : {}),
    prepared: hydratePreparedOperation(wire.prepared),
    vault: {
      accountIndex: wire.vault.accountIndex,
      pubkey: new PublicKey(wire.vault.pubkey),
      usdcAta: new PublicKey(wire.vault.usdcAta),
    },
  };
}

function assertRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object.");
  }

  return body as Record<string, unknown>;
}

function readUnsignedIntegerString(
  body: Record<string, unknown>,
  key: string
): string {
  const value = body[key];
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    throw new Error(`${key} must be an unsigned integer string.`);
  }
  return value.trim();
}

function readNonEmptyString(
  body: Record<string, unknown>,
  key: string
): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value.trim();
}

export function parseEarnWithdrawCleanupConfirmRequestBody(
  body: unknown
): EarnWithdrawCleanupConfirmRequestBody {
  const record = assertRecord(body);
  const preparedCleanup = record.preparedCleanup;
  if (!preparedCleanup || typeof preparedCleanup !== "object") {
    throw new Error("preparedCleanup must be an object.");
  }
  const autodepositCloseSignature = record.autodepositCloseSignature;
  const autodepositCloseConfirmedSlot = record.autodepositCloseConfirmedSlot;

  return {
    cleanupSignature: readNonEmptyString(record, "cleanupSignature"),
    confirmedSlot: readUnsignedIntegerString(record, "confirmedSlot"),
    preparedCleanup:
      preparedCleanup as WireSmartAccountPreparedEarnUsdcCleanup,
    ...(typeof autodepositCloseSignature === "string" &&
    autodepositCloseSignature.trim().length > 0
      ? { autodepositCloseSignature: autodepositCloseSignature.trim() }
      : {}),
    ...(typeof autodepositCloseConfirmedSlot === "string" &&
    /^\d+$/.test(autodepositCloseConfirmedSlot.trim())
      ? { autodepositCloseConfirmedSlot: autodepositCloseConfirmedSlot.trim() }
      : {}),
  };
}
