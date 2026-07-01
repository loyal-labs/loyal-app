import type {
  SmartAccountEarnUsdcDepositMetadata,
  SmartAccountNativeSolRequirement,
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
  nativeSolRequirement: SmartAccountNativeSolRequirement;
  persistence: SmartAccountEarnUsdcDepositMetadata;
  policyFinalizePrepared?: WirePreparedLoyalSmartAccountsOperation | null;
  policy: {
    account: string;
    id: string;
    sameMintInstructionConstraintIndexes: readonly [number, number];
    seed: string;
  };
  setupPolicy?: {
    account: string;
    id: string;
    initObligationInstructionConstraintIndex: 0;
    seed: string;
  };
  policySetupPrepared?: WirePreparedLoyalSmartAccountsOperation | null;
  prepared: WirePreparedLoyalSmartAccountsOperation;
  targetReserve: {
    liquidityMint: string;
    market: string;
    obligation: string;
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

export function parseEarnDepositPrepareRequestBody(body: unknown): {
  amountRaw: bigint;
} {
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
    nativeSolRequirement: preparedDeposit.nativeSolRequirement,
    persistence: preparedDeposit.persistence,
    policyFinalizePrepared: preparedDeposit.policyFinalizePrepared
      ? serializePreparedOperation(preparedDeposit.policyFinalizePrepared)
      : null,
    policy: {
      account: preparedDeposit.policy.account.toBase58(),
      id: preparedDeposit.policy.id.toString(),
      sameMintInstructionConstraintIndexes:
        preparedDeposit.policy.sameMintInstructionConstraintIndexes,
      seed: preparedDeposit.policy.seed.toString(),
    },
    ...(preparedDeposit.setupPolicy
      ? {
          setupPolicy: {
            account: preparedDeposit.setupPolicy.account.toBase58(),
            id: preparedDeposit.setupPolicy.id.toString(),
            initObligationInstructionConstraintIndex:
              preparedDeposit.setupPolicy
                .initObligationInstructionConstraintIndex,
            seed: preparedDeposit.setupPolicy.seed.toString(),
          },
        }
      : {}),
    policySetupPrepared: preparedDeposit.policySetupPrepared
      ? serializePreparedOperation(preparedDeposit.policySetupPrepared)
      : null,
    prepared: serializePreparedOperation(preparedDeposit.prepared),
    targetReserve: {
      liquidityMint: preparedDeposit.targetReserve.liquidityMint.toBase58(),
      market: preparedDeposit.targetReserve.market.toBase58(),
      obligation: preparedDeposit.targetReserve.obligation.toBase58(),
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
    nativeSolRequirement: wire.nativeSolRequirement,
    persistence: wire.persistence,
    policyFinalizePrepared: wire.policyFinalizePrepared
      ? hydratePreparedOperation(wire.policyFinalizePrepared)
      : null,
    policy: {
      account: new PublicKey(wire.policy.account),
      id: BigInt(wire.policy.id),
      sameMintInstructionConstraintIndexes:
        wire.policy.sameMintInstructionConstraintIndexes,
      seed: BigInt(wire.policy.seed),
    },
    ...(wire.setupPolicy
      ? {
          setupPolicy: {
            account: new PublicKey(wire.setupPolicy.account),
            id: BigInt(wire.setupPolicy.id),
            initObligationInstructionConstraintIndex:
              wire.setupPolicy.initObligationInstructionConstraintIndex,
            seed: BigInt(wire.setupPolicy.seed),
          },
        }
      : {}),
    policySetupPrepared: wire.policySetupPrepared
      ? hydratePreparedOperation(wire.policySetupPrepared)
      : null,
    prepared: hydratePreparedOperation(wire.prepared),
    targetReserve: {
      liquidityMint: new PublicKey(wire.targetReserve.liquidityMint),
      market: new PublicKey(wire.targetReserve.market),
      obligation: new PublicKey(wire.targetReserve.obligation),
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
