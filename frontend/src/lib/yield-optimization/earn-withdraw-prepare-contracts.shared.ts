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
  prepared: WirePreparedLoyalSmartAccountsOperation;
  targetReserve: {
    liquidityMint: string;
    market: string;
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
} {
  const record = assertRequestObject(body);
  const amountRaw = BigInt(readUnsignedIntegerString(record, "amountRaw"));

  if (amountRaw <= BigInt(0)) {
    throw new Error("amountRaw must be greater than 0.");
  }

  return {
    amountRaw,
    mode: readWithdrawMode(record),
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
    prepared: serializePreparedOperation(preparedWithdraw.prepared),
    targetReserve: {
      liquidityMint: preparedWithdraw.targetReserve.liquidityMint.toBase58(),
      market: preparedWithdraw.targetReserve.market.toBase58(),
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
    prepared: hydratePreparedOperation(wire.prepared),
    targetReserve: {
      liquidityMint: new PublicKey(wire.targetReserve.liquidityMint),
      market: new PublicKey(wire.targetReserve.market),
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
