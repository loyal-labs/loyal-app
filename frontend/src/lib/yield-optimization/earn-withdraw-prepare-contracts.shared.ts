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
  amountRaw: string;
  mode: "partial" | "full";
  source?: {
    amountRaw?: string;
    id: string;
    liquidityMint?: string;
    market?: string | null;
    mint?: string;
    reserve?: string;
    tokenAccount?: string;
    type: "reserve" | "idle";
  } | null;
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
    };
    amountRaw: string;
    collateralAta: string;
    executionReserve: {
      liquidityMint: string;
      market: string;
      reserve: string;
    };
    mode: "partial" | "full";
    persistence: SmartAccountEarnUsdcWithdrawMetadata;
    prepared: WirePreparedLoyalSmartAccountsOperation;
    reserveWithdrawals?: SmartAccountEarnUsdcWithdrawMetadata["reserveWithdrawals"];
    stepCount: number;
    stepIndex: number;
  }>;
  targetReserve: {
    liquidityMint: string;
    market: string;
    obligation: string;
    reserve: string;
  };
  vault: {
    accountIndex: 1;
    collateralAta: string;
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

function readWithdrawMode(body: EarnWithdrawPrepareRecord) {
  const value = body.mode;

  if (value !== "partial" && value !== "full") {
    throw new Error("mode must be partial or full.");
  }

  return value;
}

export function parseEarnWithdrawPrepareRequestBody(body: unknown): {
  amountRaw: bigint;
  mode: "partial" | "full";
  source: EarnWithdrawPrepareRequestBody["source"];
} {
  const record = assertRequestObject(body);
  const amountRaw = BigInt(readUnsignedIntegerString(record, "amountRaw"));

  if (amountRaw <= BigInt(0)) {
    throw new Error("amountRaw must be greater than 0.");
  }

  return {
    amountRaw,
    mode: readWithdrawMode(record),
    source: readOptionalWithdrawSource(record),
  };
}

function readOptionalWithdrawSource(
  body: EarnWithdrawPrepareRecord
): EarnWithdrawPrepareRequestBody["source"] {
  const value = body.source;
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object") {
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
      accountingReserve: {
        liquidityMint: step.accountingReserve.liquidityMint.toBase58(),
        market: step.accountingReserve.market.toBase58(),
        obligation: step.accountingReserve.obligation.toBase58(),
        reserve: step.accountingReserve.reserve.toBase58(),
      },
      amountRaw: step.amountRaw.toString(),
      collateralAta: step.collateralAta.toBase58(),
      executionReserve: {
        liquidityMint: step.executionReserve.liquidityMint.toBase58(),
        market: step.executionReserve.market.toBase58(),
        reserve: step.executionReserve.reserve.toBase58(),
      },
      mode: step.mode,
      persistence: step.persistence,
      prepared: serializePreparedOperation(step.prepared),
      reserveWithdrawals: step.reserveWithdrawals,
      stepCount: step.stepCount,
      stepIndex: step.stepIndex,
    })),
    targetReserve: {
      liquidityMint: preparedWithdraw.targetReserve.liquidityMint.toBase58(),
      market: preparedWithdraw.targetReserve.market.toBase58(),
      obligation: preparedWithdraw.targetReserve.obligation.toBase58(),
      reserve: preparedWithdraw.targetReserve.reserve.toBase58(),
    },
    vault: {
      accountIndex: preparedWithdraw.vault.accountIndex,
      collateralAta: preparedWithdraw.vault.collateralAta.toBase58(),
      pubkey: preparedWithdraw.vault.pubkey.toBase58(),
      usdcAta: preparedWithdraw.vault.usdcAta.toBase58(),
    },
  };
}

export function hydratePreparedEarnUsdcWithdraw(
  wire: WireSmartAccountPreparedEarnUsdcWithdraw
): SmartAccountPreparedEarnUsdcWithdraw {
  const fallbackStep = {
    accountingReserve: {
      liquidityMint: new PublicKey(wire.targetReserve.liquidityMint),
      market: new PublicKey(wire.targetReserve.market),
      obligation: new PublicKey(wire.targetReserve.obligation),
      reserve: new PublicKey(wire.targetReserve.reserve),
    },
    amountRaw: BigInt(wire.amountRaw),
    collateralAta: new PublicKey(wire.vault.collateralAta),
    executionReserve: {
      liquidityMint: new PublicKey(wire.targetReserve.liquidityMint),
      market: new PublicKey(wire.targetReserve.market),
      reserve: new PublicKey(wire.targetReserve.reserve),
    },
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
      accountingReserve: {
        liquidityMint: new PublicKey(step.accountingReserve.liquidityMint),
        market: new PublicKey(step.accountingReserve.market),
        obligation: new PublicKey(step.accountingReserve.obligation),
        reserve: new PublicKey(step.accountingReserve.reserve),
      },
      amountRaw: BigInt(step.amountRaw),
      collateralAta: new PublicKey(step.collateralAta),
      executionReserve: {
        liquidityMint: new PublicKey(step.executionReserve.liquidityMint),
        market: new PublicKey(step.executionReserve.market),
        reserve: new PublicKey(step.executionReserve.reserve),
      },
      mode: step.mode,
      persistence: step.persistence,
      prepared: hydratePreparedOperation(step.prepared),
      reserveWithdrawals:
        step.reserveWithdrawals ?? step.persistence.reserveWithdrawals ?? [],
      stepCount: step.stepCount,
      stepIndex: step.stepIndex,
    })) ?? [fallbackStep],
    targetReserve: {
      liquidityMint: new PublicKey(wire.targetReserve.liquidityMint),
      market: new PublicKey(wire.targetReserve.market),
      obligation: new PublicKey(wire.targetReserve.obligation),
      reserve: new PublicKey(wire.targetReserve.reserve),
    },
    vault: {
      accountIndex: wire.vault.accountIndex,
      collateralAta: new PublicKey(wire.vault.collateralAta),
      pubkey: new PublicKey(wire.vault.pubkey),
      usdcAta: new PublicKey(wire.vault.usdcAta),
    },
  };
}
