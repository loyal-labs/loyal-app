import type {
  SmartAccountEarnUsdcDepositMetadata,
  SmartAccountPreparedEarnUsdcDeposit,
} from "@loyal-labs/smart-account-vaults";
import { PublicKey } from "@solana/web3.js";

import {
  hydratePreparedOperation,
  serializePreparedOperation,
  type WirePreparedLoyalSmartAccountsOperation,
} from "@/lib/smart-accounts/prepared-operation-wire.shared";

export type EarnDepositPrepareRequestBody = {
  amountRaw: string;
};

export type WireSmartAccountPreparedEarnUsdcDeposit = {
  kaminoSetupAccountCount: number;
  kaminoSetupRentLamports: string;
  kaminoSetupRequired: boolean;
  persistence: SmartAccountEarnUsdcDepositMetadata;
  policy: {
    account: string;
    id: string;
    sameMintInstructionConstraintIndexes: readonly [number, number];
    seed: string;
  };
  prepared: WirePreparedLoyalSmartAccountsOperation;
  targetReserve: {
    liquidityMint: string;
    market: string;
    reserve: string;
    supplyApyBps: string | null;
  };
  vault: {
    accountIndex: 1;
    collateralAta: string | null;
    pubkey: string;
    usdcAta: string;
  };
};

export type EarnDepositPrepareResponse = {
  preparedDeposit: WireSmartAccountPreparedEarnUsdcDeposit;
};

type EarnDepositPrepareRecord = Record<string, unknown>;

function assertRequestObject(body: unknown): EarnDepositPrepareRecord {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be an object.");
  }

  return body as EarnDepositPrepareRecord;
}

function readUnsignedIntegerString(
  body: EarnDepositPrepareRecord,
  key: string
): string {
  const value = body[key];

  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    throw new Error(`${key} must be an unsigned integer string.`);
  }

  return value.trim();
}

export function parseEarnDepositPrepareRequestBody(
  body: unknown
): { amountRaw: bigint } {
  const record = assertRequestObject(body);
  const amountRaw = BigInt(readUnsignedIntegerString(record, "amountRaw"));

  if (amountRaw <= BigInt(0)) {
    throw new Error("amountRaw must be greater than 0.");
  }

  return { amountRaw };
}

export function serializePreparedEarnUsdcDeposit(
  preparedDeposit: SmartAccountPreparedEarnUsdcDeposit
): WireSmartAccountPreparedEarnUsdcDeposit {
  return {
    kaminoSetupAccountCount: preparedDeposit.kaminoSetupAccountCount,
    kaminoSetupRentLamports: preparedDeposit.kaminoSetupRentLamports,
    kaminoSetupRequired: preparedDeposit.kaminoSetupRequired,
    persistence: preparedDeposit.persistence,
    policy: {
      account: preparedDeposit.policy.account.toBase58(),
      id: preparedDeposit.policy.id.toString(),
      sameMintInstructionConstraintIndexes:
        preparedDeposit.policy.sameMintInstructionConstraintIndexes,
      seed: preparedDeposit.policy.seed.toString(),
    },
    prepared: serializePreparedOperation(preparedDeposit.prepared),
    targetReserve: {
      liquidityMint: preparedDeposit.targetReserve.liquidityMint.toBase58(),
      market: preparedDeposit.targetReserve.market.toBase58(),
      reserve: preparedDeposit.targetReserve.reserve.toBase58(),
      supplyApyBps:
        preparedDeposit.targetReserve.supplyApyBps?.toString() ?? null,
    },
    vault: {
      accountIndex: preparedDeposit.vault.accountIndex,
      collateralAta: preparedDeposit.vault.collateralAta?.toBase58() ?? null,
      pubkey: preparedDeposit.vault.pubkey.toBase58(),
      usdcAta: preparedDeposit.vault.usdcAta.toBase58(),
    },
  };
}

export function hydratePreparedEarnUsdcDeposit(
  wire: WireSmartAccountPreparedEarnUsdcDeposit
): SmartAccountPreparedEarnUsdcDeposit {
  return {
    kaminoSetupAccountCount: wire.kaminoSetupAccountCount,
    kaminoSetupRentLamports: wire.kaminoSetupRentLamports,
    kaminoSetupRequired: wire.kaminoSetupRequired,
    persistence: wire.persistence,
    policy: {
      account: new PublicKey(wire.policy.account),
      id: BigInt(wire.policy.id),
      sameMintInstructionConstraintIndexes:
        wire.policy.sameMintInstructionConstraintIndexes,
      seed: BigInt(wire.policy.seed),
    },
    prepared: hydratePreparedOperation(wire.prepared),
    targetReserve: {
      liquidityMint: new PublicKey(wire.targetReserve.liquidityMint),
      market: new PublicKey(wire.targetReserve.market),
      reserve: new PublicKey(wire.targetReserve.reserve),
      supplyApyBps: wire.targetReserve.supplyApyBps
        ? BigInt(wire.targetReserve.supplyApyBps)
        : null,
    },
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
