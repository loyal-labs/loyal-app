import type {
  SmartAccountEarnUsdcWithdrawMetadata,
  SmartAccountPreparedEarnUsdcWithdraw,
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

export type EarnWithdrawPrepareRequestBody = {
  amountRaw: string | "max";
  sourceId: string;
};

// Legacy wire shape: `{ amountRaw, mode, source }`. Every mobile binary and
// OTA shipped before the sourceId contract still sends it, and the change
// silently 400'd the whole mobile withdraw fleet (ASK-2099) — so the parser
// accepts both shapes and resolution maps legacy requests with the matcher
// that contract used. Delete once the mobile fleet speaks sourceId.
export type EarnWithdrawLegacySourceRequest = {
  amountRaw?: string;
  id: string;
  liquidityMint?: string;
  market?: string | null;
  mint?: string;
  reserve?: string;
  tokenAccount?: string;
  type: "reserve" | "idle";
} | null;

export type EarnWithdrawLegacyPrepareRequest = {
  mode: "partial" | "full";
  source: EarnWithdrawLegacySourceRequest;
};

export type WireSmartAccountPreparedEarnUsdcWithdraw = {
  amountRaw: string;
  autodepositClosePrepared?: WireSmartAccountPreparedEarnUsdcAutodepositClose | null;
  mode: "partial" | "full";
  persistence: SmartAccountEarnUsdcWithdrawMetadata;
  policy: {
    account: string;
    id: string;
    sameMintInstructionConstraintIndexes: readonly [number, number];
    seed: string;
    withdrawInstructionConstraintIndex: 0;
  };
  setupPolicy?: {
    account: string;
    id: string;
    seed: string;
  };
  prepared: WirePreparedLoyalSmartAccountsOperation;
  withdrawSteps?: Array<{
    accountingReserve: {
      liquidityMint: string;
      market: string;
      obligation: string;
      reserve: string;
    } | null;
    amountRaw: string;
    collateralAta: string | null;
    executionReserve: {
      liquidityMint: string;
      market: string;
      reserve: string;
    } | null;
    mode: "partial" | "full";
    persistence: SmartAccountEarnUsdcWithdrawMetadata;
    prepared: WirePreparedLoyalSmartAccountsOperation;
    reserveWithdrawals?: SmartAccountEarnUsdcWithdrawMetadata["reserveWithdrawals"];
    stepCount: number;
    stepIndex: number;
  }>;
  targetReserve: {
    liquidityMint: string;
    liquidityTokenProgram: string;
    market: string;
    obligation: string;
    reserve: string;
  } | null;
  vault: {
    accountIndex: 1;
    collateralAta: string | null;
    pubkey: string;
    usdcAta: string;
  };
};

export type EarnWithdrawPrepareResponse = {
  preparedWithdraw: WireSmartAccountPreparedEarnUsdcWithdraw;
};

type EarnWithdrawPrepareRecord = Record<string, unknown>;

function assertRequestObject(body: unknown): EarnWithdrawPrepareRecord {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object.");
  }

  return body as EarnWithdrawPrepareRecord;
}

function readUnsignedIntegerString(
  body: EarnWithdrawPrepareRecord,
  key: string
): string {
  const value = body[key];

  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    throw new Error(`${key} must be an unsigned integer string.`);
  }

  return value.trim();
}

export function parseEarnWithdrawPrepareRequestBody(body: unknown): {
  amountRaw: bigint | "max";
  sourceId: string | null;
  legacy: EarnWithdrawLegacyPrepareRequest | null;
} {
  const record = assertRequestObject(body);
  const amountValue = record.amountRaw;
  const amountRaw =
    amountValue === "max"
      ? "max"
      : BigInt(readUnsignedIntegerString(record, "amountRaw"));

  if (amountRaw !== "max" && amountRaw <= BigInt(0)) {
    throw new Error("amountRaw must be greater than 0.");
  }

  if (
    record.sourceId === undefined &&
    (record.mode === "partial" || record.mode === "full")
  ) {
    if (amountRaw === "max") {
      throw new Error("amountRaw must be an unsigned integer string.");
    }
    return {
      amountRaw,
      sourceId: null,
      legacy: { mode: record.mode, source: readLegacyWithdrawSource(record) },
    };
  }

  const sourceId = record.sourceId;
  if (typeof sourceId !== "string" || sourceId.trim().length === 0) {
    throw new Error("sourceId must be a non-empty string.");
  }

  return {
    amountRaw,
    sourceId: sourceId.trim(),
    legacy: null,
  };
}

function readLegacyWithdrawSource(
  body: EarnWithdrawPrepareRecord
): EarnWithdrawLegacySourceRequest {
  const value = body.source;
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object") {
    throw new Error("source must be an object when provided.");
  }
  const source = value as EarnWithdrawPrepareRecord;
  const type = source.type;
  if (type !== "reserve" && type !== "idle") {
    throw new Error("source.type must be reserve or idle.");
  }
  const id = source.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error("source.id must be a non-empty string.");
  }

  return {
    amountRaw:
      typeof source.amountRaw === "string" && /^\d+$/.test(source.amountRaw)
        ? source.amountRaw
        : undefined,
    id: id.trim(),
    liquidityMint:
      typeof source.liquidityMint === "string"
        ? source.liquidityMint.trim()
        : undefined,
    market:
      typeof source.market === "string"
        ? source.market.trim()
        : source.market === null
          ? null
          : undefined,
    mint: typeof source.mint === "string" ? source.mint.trim() : undefined,
    reserve:
      typeof source.reserve === "string" ? source.reserve.trim() : undefined,
    tokenAccount:
      typeof source.tokenAccount === "string"
        ? source.tokenAccount.trim()
        : undefined,
    type,
  };
}

export function serializePreparedEarnUsdcWithdraw(
  preparedWithdraw: SmartAccountPreparedEarnUsdcWithdraw
): WireSmartAccountPreparedEarnUsdcWithdraw {
  return {
    amountRaw: preparedWithdraw.amountRaw.toString(),
    autodepositClosePrepared: preparedWithdraw.autodepositClosePrepared
      ? serializePreparedEarnUsdcAutodepositClose(
          preparedWithdraw.autodepositClosePrepared
        )
      : null,
    mode: preparedWithdraw.mode,
    persistence: preparedWithdraw.persistence,
    policy: {
      account: preparedWithdraw.policy.account.toBase58(),
      id: preparedWithdraw.policy.id.toString(),
      sameMintInstructionConstraintIndexes:
        preparedWithdraw.policy.sameMintInstructionConstraintIndexes,
      seed: preparedWithdraw.policy.seed.toString(),
      withdrawInstructionConstraintIndex:
        preparedWithdraw.policy.withdrawInstructionConstraintIndex,
    },
    ...(preparedWithdraw.setupPolicy
      ? {
          setupPolicy: {
            account: preparedWithdraw.setupPolicy.account.toBase58(),
            id: preparedWithdraw.setupPolicy.id.toString(),
            seed: preparedWithdraw.setupPolicy.seed.toString(),
          },
        }
      : {}),
    prepared: serializePreparedOperation(preparedWithdraw.prepared),
    withdrawSteps: preparedWithdraw.withdrawSteps.map((step) => ({
      accountingReserve: step.accountingReserve
        ? {
            liquidityMint: step.accountingReserve.liquidityMint.toBase58(),
            market: step.accountingReserve.market.toBase58(),
            obligation: step.accountingReserve.obligation.toBase58(),
            reserve: step.accountingReserve.reserve.toBase58(),
          }
        : null,
      amountRaw: step.amountRaw.toString(),
      collateralAta: step.collateralAta?.toBase58() ?? null,
      executionReserve: step.executionReserve
        ? {
            liquidityMint: step.executionReserve.liquidityMint.toBase58(),
            market: step.executionReserve.market.toBase58(),
            reserve: step.executionReserve.reserve.toBase58(),
          }
        : null,
      mode: step.mode,
      persistence: step.persistence,
      prepared: serializePreparedOperation(step.prepared),
      reserveWithdrawals: step.reserveWithdrawals,
      stepCount: step.stepCount,
      stepIndex: step.stepIndex,
    })),
    targetReserve: preparedWithdraw.targetReserve
      ? {
          liquidityMint:
            preparedWithdraw.targetReserve.liquidityMint.toBase58(),
          liquidityTokenProgram:
            preparedWithdraw.targetReserve.liquidityTokenProgram.toBase58(),
          market: preparedWithdraw.targetReserve.market.toBase58(),
          obligation: preparedWithdraw.targetReserve.obligation.toBase58(),
          reserve: preparedWithdraw.targetReserve.reserve.toBase58(),
        }
      : null,
    vault: {
      accountIndex: preparedWithdraw.vault.accountIndex,
      collateralAta: preparedWithdraw.vault.collateralAta?.toBase58() ?? null,
      pubkey: preparedWithdraw.vault.pubkey.toBase58(),
      usdcAta: preparedWithdraw.vault.usdcAta.toBase58(),
    },
  };
}

export function hydratePreparedEarnUsdcWithdraw(
  wire: WireSmartAccountPreparedEarnUsdcWithdraw
): SmartAccountPreparedEarnUsdcWithdraw {
  const fallbackStep = {
    accountingReserve: wire.targetReserve
      ? {
          liquidityMint: new PublicKey(wire.targetReserve.liquidityMint),
          market: new PublicKey(wire.targetReserve.market),
          obligation: new PublicKey(wire.targetReserve.obligation),
          reserve: new PublicKey(wire.targetReserve.reserve),
        }
      : null,
    amountRaw: BigInt(wire.amountRaw),
    collateralAta: wire.vault.collateralAta
      ? new PublicKey(wire.vault.collateralAta)
      : null,
    executionReserve: wire.targetReserve
      ? {
          liquidityMint: new PublicKey(wire.targetReserve.liquidityMint),
          market: new PublicKey(wire.targetReserve.market),
          reserve: new PublicKey(wire.targetReserve.reserve),
        }
      : null,
    mode: wire.mode,
    persistence: wire.persistence,
    prepared: hydratePreparedOperation(wire.prepared),
    reserveWithdrawals: wire.persistence.reserveWithdrawals ?? [],
    stepCount: 1,
    stepIndex: 0,
  };

  return {
    amountRaw: BigInt(wire.amountRaw),
    autodepositClosePrepared: wire.autodepositClosePrepared
      ? hydratePreparedEarnUsdcAutodepositClose(wire.autodepositClosePrepared)
      : null,
    mode: wire.mode,
    persistence: wire.persistence,
    policy: {
      account: new PublicKey(wire.policy.account),
      id: BigInt(wire.policy.id),
      sameMintInstructionConstraintIndexes:
        wire.policy.sameMintInstructionConstraintIndexes,
      seed: BigInt(wire.policy.seed),
      withdrawInstructionConstraintIndex:
        wire.policy.withdrawInstructionConstraintIndex,
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
    withdrawSteps: wire.withdrawSteps?.map((step) => ({
      accountingReserve: step.accountingReserve
        ? {
            liquidityMint: new PublicKey(step.accountingReserve.liquidityMint),
            market: new PublicKey(step.accountingReserve.market),
            obligation: new PublicKey(step.accountingReserve.obligation),
            reserve: new PublicKey(step.accountingReserve.reserve),
          }
        : null,
      amountRaw: BigInt(step.amountRaw),
      collateralAta: step.collateralAta
        ? new PublicKey(step.collateralAta)
        : null,
      executionReserve: step.executionReserve
        ? {
            liquidityMint: new PublicKey(step.executionReserve.liquidityMint),
            market: new PublicKey(step.executionReserve.market),
            reserve: new PublicKey(step.executionReserve.reserve),
          }
        : null,
      mode: step.mode,
      persistence: step.persistence,
      prepared: hydratePreparedOperation(step.prepared),
      reserveWithdrawals:
        step.reserveWithdrawals ?? step.persistence.reserveWithdrawals ?? [],
      stepCount: step.stepCount,
      stepIndex: step.stepIndex,
    })) ?? [fallbackStep],
    targetReserve: wire.targetReserve
      ? {
          liquidityMint: new PublicKey(wire.targetReserve.liquidityMint),
          liquidityTokenProgram: new PublicKey(
            wire.targetReserve.liquidityTokenProgram
          ),
          market: new PublicKey(wire.targetReserve.market),
          obligation: new PublicKey(wire.targetReserve.obligation),
          reserve: new PublicKey(wire.targetReserve.reserve),
        }
      : null,
    vault: {
      accountIndex: wire.vault.accountIndex,
      collateralAta: wire.vault.collateralAta
        ? new PublicKey(wire.vault.collateralAta)
        : null,
      pubkey: new PublicKey(wire.vault.pubkey),
      usdcAta: new PublicKey(wire.vault.usdcAta),
    },
  };
}
