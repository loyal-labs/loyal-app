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
  sponsored?: boolean;
};

export type WireSmartAccountPreparedEarnUsdcDeposit = {
  kaminoSetupAccountCount: number;
  kaminoSetupPrepared?: WirePreparedLoyalSmartAccountsOperation | null;
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

export type SponsoredEarnDepositPrefundInput = {
  cluster: string;
  policyAccount: string;
  policyInitialization: "create" | "reuse";
  policySeed: bigint;
  requiredLamports: bigint;
  settings: string;
  vaultIndex: 1;
  vaultPubkey: string;
  walletAddress: string;
};

export type SponsoredEarnDepositPrefundConfirmation = {
  balanceLamports: string;
  confirmedSlot?: string;
  destination: string;
  lamports: string;
  requiredLamports: string;
  signature?: string;
  status: "skipped" | "transferred";
};

export type EarnSponsoredDepositPrefundRequestBody = {
  cluster: string;
  policyAccount: string;
  policyInitialization: "create" | "reuse";
  policySeed: string;
  requiredLamports: string;
  settings: string;
  vaultIndex: 1;
  vaultPubkey: string;
  walletAddress: string;
};

export type EarnSponsoredDepositPrefundResponse = {
  sponsoredPrefund: SponsoredEarnDepositPrefundConfirmation;
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

function readRequiredString(
  body: EarnDepositPrepareRecord,
  key: string
): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value.trim();
}

function readPolicyInitialization(
  body: EarnDepositPrepareRecord
): "create" | "reuse" {
  const value = readRequiredString(body, "policyInitialization");
  if (value !== "create" && value !== "reuse") {
    throw new Error("policyInitialization must be create or reuse.");
  }
  return value;
}

function readVaultIndex(body: EarnDepositPrepareRecord): 1 {
  const value = body.vaultIndex;
  if (value !== 1) {
    throw new Error("vaultIndex must be 1 for Earn deposits.");
  }
  return value;
}

export function parseEarnDepositPrepareRequestBody(body: unknown): {
  amountRaw: bigint;
  sponsored: boolean;
} {
  const record = assertRequestObject(body);
  const amountRaw = BigInt(readUnsignedIntegerString(record, "amountRaw"));
  const sponsored =
    record.sponsored === undefined || record.sponsored === null
      ? false
      : record.sponsored;

  if (typeof sponsored !== "boolean") {
    throw new Error("sponsored must be a boolean when provided.");
  }

  if (amountRaw <= BigInt(0)) {
    throw new Error("amountRaw must be greater than 0.");
  }

  return { amountRaw, sponsored };
}

export function buildEarnSponsoredDepositPrefundRequestBody({
  preparedDeposit,
}: {
  preparedDeposit: SmartAccountPreparedEarnUsdcDeposit;
}): EarnSponsoredDepositPrefundRequestBody {
  const persistence = preparedDeposit.persistence;
  return {
    cluster: persistence.cluster,
    policyAccount: persistence.policyAccount,
    policyInitialization: persistence.policyInitialization,
    policySeed: persistence.policySeed,
    requiredLamports: preparedDeposit.nativeSolRequirement.requiredLamports,
    settings: persistence.settings,
    vaultIndex: persistence.vaultIndex,
    vaultPubkey: persistence.vaultPubkey,
    walletAddress: persistence.walletAddress,
  };
}

export function parseEarnSponsoredDepositPrefundRequestBody(
  body: unknown
): SponsoredEarnDepositPrefundInput {
  const record = assertRequestObject(body);
  return {
    cluster: readRequiredString(record, "cluster"),
    policyAccount: readRequiredString(record, "policyAccount"),
    policyInitialization: readPolicyInitialization(record),
    policySeed: BigInt(readUnsignedIntegerString(record, "policySeed")),
    requiredLamports: BigInt(
      readUnsignedIntegerString(record, "requiredLamports")
    ),
    settings: readRequiredString(record, "settings"),
    vaultIndex: readVaultIndex(record),
    vaultPubkey: readRequiredString(record, "vaultPubkey"),
    walletAddress: readRequiredString(record, "walletAddress"),
  };
}

export function serializePreparedEarnUsdcDeposit(
  preparedDeposit: SmartAccountPreparedEarnUsdcDeposit
): WireSmartAccountPreparedEarnUsdcDeposit {
  return {
    kaminoSetupAccountCount: preparedDeposit.kaminoSetupAccountCount,
    kaminoSetupPrepared: preparedDeposit.kaminoSetupPrepared
      ? serializePreparedOperation(preparedDeposit.kaminoSetupPrepared)
      : null,
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
    kaminoSetupPrepared: wire.kaminoSetupPrepared
      ? hydratePreparedOperation(wire.kaminoSetupPrepared)
      : null,
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
