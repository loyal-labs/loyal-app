import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import type { LoyalClusterConfig } from "../cluster.ts";
import type { PolicySeed } from "../types.ts";
import { normalizeU64 } from "../subscriptions.ts";
import { BytesEncoder } from "./bytes.ts";

const SQUADS_SEED_PREFIX = new TextEncoder().encode("smart_account");
const SQUADS_SEED_POLICY = new TextEncoder().encode("policy");
const SQUADS_FULL_PERMISSIONS_MASK = 7;
const SQUADS_SYNC_SIGNER_COUNT = 1;
const EXECUTE_SETTINGS_TRANSACTION_SYNC_DISCRIMINATOR = [
  138, 209, 64, 163, 79, 67, 233, 76,
] as const;

export type DataConstraint = {
  dataOffset: bigint;
  dataValue:
    | { type: "u8"; value: number }
    | { type: "u16Le"; value: number }
    | { type: "u32Le"; value: number }
    | { type: "u64Le"; value: bigint }
    | { type: "u128Le"; value: bigint }
    | { type: "u8Slice"; value: readonly number[] };
  operator:
    | "equals"
    | "notEquals"
    | "greaterThan"
    | "greaterThanOrEqualTo"
    | "lessThan"
    | "lessThanOrEqualTo";
};

export type AccountConstraint = {
  accountIndex: number;
  kind:
    | { type: "pubkey"; pubkeys: readonly PublicKey[] }
    | { type: "accountData"; dataConstraints: readonly DataConstraint[] };
  owner?: PublicKey;
};

export type InstructionConstraint = {
  programId: PublicKey;
  accountConstraints: readonly AccountConstraint[];
  dataConstraints: readonly DataConstraint[];
};

export type SquadsContext = {
  settings: PublicKey;
  authority: PublicKey;
  delegatedSigner: PublicKey;
  accountIndex: number;
  vault: PublicKey;
};

export function deriveActionAccount(
  config: LoyalClusterConfig,
  settings: PublicKey,
  policySeed: PolicySeed,
): PublicKey {
  const normalizedSeed = normalizeU64(policySeed, "policySeed");
  const seedBytes = new Uint8Array(8);
  new DataView(seedBytes.buffer).setBigUint64(0, normalizedSeed, true);
  return PublicKey.findProgramAddressSync(
    [SQUADS_SEED_PREFIX, SQUADS_SEED_POLICY, settings.toBytes(), seedBytes],
    config.squadsSmartAccountProgramId
  )[0];
}

export function createProgramInteractionPolicyInstruction(
  config: LoyalClusterConfig,
  context: SquadsContext,
  constraints: readonly InstructionConstraint[],
  policySeed: PolicySeed,
): TransactionInstruction {
  const normalizedSeed = normalizeU64(policySeed, "policySeed");
  const actionAccount = deriveActionAccount(config, context.settings, normalizedSeed);
  const data = serializeSettingsActions(
    context.delegatedSigner,
    normalizedSeed,
    compileProgramInteractionPayload(context.accountIndex, constraints)
  );

  return new TransactionInstruction({
    programId: config.squadsSmartAccountProgramId,
    keys: [
      { pubkey: context.settings, isSigner: false, isWritable: true },
      { pubkey: context.authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      {
        pubkey: config.squadsSmartAccountProgramId,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: context.authority, isSigner: true, isWritable: false },
      { pubkey: actionAccount, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(data),
  });
}

type CompiledPayload = {
  accountIndex: number;
  pubkeyTable: PublicKey[];
  instructionConstraints: CompiledInstructionConstraint[];
};

type CompiledInstructionConstraint = {
  programIdIndex: number;
  accountConstraints: CompiledAccountConstraint[];
  dataConstraints: readonly DataConstraint[];
};

type CompiledAccountConstraint = {
  accountIndex: number;
  kind:
    | { type: "pubkey"; pubkeyIndexes: number[] }
    | { type: "accountData"; dataConstraints: readonly DataConstraint[] };
  ownerIndex?: number;
};

function compileProgramInteractionPayload(
  accountIndex: number,
  constraints: readonly InstructionConstraint[]
): CompiledPayload {
  const pubkeyTable: PublicKey[] = [];
  return {
    accountIndex,
    pubkeyTable,
    instructionConstraints: constraints.map((constraint) =>
      compileInstructionConstraint(constraint, pubkeyTable)
    ),
  };
}

function compileInstructionConstraint(
  constraint: InstructionConstraint,
  pubkeyTable: PublicKey[]
): CompiledInstructionConstraint {
  return {
    programIdIndex: pubkeyTableIndex(pubkeyTable, constraint.programId),
    accountConstraints: constraint.accountConstraints.map((accountConstraint) =>
      compileAccountConstraint(accountConstraint, pubkeyTable)
    ),
    dataConstraints: constraint.dataConstraints,
  };
}

function compileAccountConstraint(
  constraint: AccountConstraint,
  pubkeyTable: PublicKey[]
): CompiledAccountConstraint {
  return {
    accountIndex: constraint.accountIndex,
    kind:
      constraint.kind.type === "pubkey"
        ? {
            type: "pubkey",
            pubkeyIndexes: constraint.kind.pubkeys.map((pubkey) =>
              pubkeyTableIndex(pubkeyTable, pubkey)
            ),
          }
        : {
            type: "accountData",
            dataConstraints: constraint.kind.dataConstraints,
          },
    ownerIndex: constraint.owner
      ? pubkeyTableIndex(pubkeyTable, constraint.owner)
      : undefined,
  };
}

function pubkeyTableIndex(pubkeyTable: PublicKey[], pubkey: PublicKey): number {
  const key = pubkey.toBase58();
  const existing = pubkeyTable.findIndex(
    (candidate) => candidate.toBase58() === key
  );
  if (existing !== -1) {
    return existing;
  }
  if (pubkeyTable.length >= 240) {
    throw new Error("Squads ProgramInteraction pubkey table overflow");
  }
  pubkeyTable.push(pubkey);
  return pubkeyTable.length - 1;
}

function serializeSettingsActions(
  delegatedSigner: PublicKey,
  seed: bigint,
  payload: CompiledPayload
): Uint8Array {
  const encoder = new BytesEncoder();
  encoder.pushBytes(EXECUTE_SETTINGS_TRANSACTION_SYNC_DISCRIMINATOR);
  encoder.pushU8(SQUADS_SYNC_SIGNER_COUNT);
  encoder.pushVec([undefined], () =>
    encodePolicyCreateAction(encoder, delegatedSigner, seed, payload)
  );
  encoder.pushOption<string>(undefined, (memo) => {
    const bytes = new TextEncoder().encode(memo);
    encoder.pushU32(bytes.length);
    encoder.pushBytes(bytes);
  });
  return encoder.finish();
}

function encodePolicyCreateAction(
  encoder: BytesEncoder,
  delegatedSigner: PublicKey,
  seed: bigint,
  payload: CompiledPayload
): void {
  encoder.pushU8(7);
  encoder.pushU64(seed);
  encoder.pushU8(4);
  encodeProgramInteractionPayload(encoder, payload);
  encoder.pushVec([delegatedSigner], (signer) => {
    encoder.pushPubkey(signer);
    encoder.pushU8(SQUADS_FULL_PERMISSIONS_MASK);
  });
  encoder.pushU16(1);
  encoder.pushU32(0);
  encoder.pushOption<bigint>(undefined, (timestamp) =>
    encoder.pushU64(timestamp)
  );
  encoder.pushOption<never>(undefined, () => undefined);
}

function encodeProgramInteractionPayload(
  encoder: BytesEncoder,
  payload: CompiledPayload
): void {
  encoder.pushU8(payload.accountIndex);
  encoder.pushSmallVec(payload.pubkeyTable, (pubkey) =>
    encoder.pushPubkey(pubkey)
  );
  encoder.pushSmallVec(payload.instructionConstraints, (constraint) => {
    encoder.pushU8(constraint.programIdIndex);
    encoder.pushSmallVec(constraint.accountConstraints, (accountConstraint) => {
      encoder.pushU8(accountConstraint.accountIndex);
      if (accountConstraint.kind.type === "pubkey") {
        encoder.pushU8(0);
        encoder.pushSmallVec(accountConstraint.kind.pubkeyIndexes, (index) =>
          encoder.pushU8(index)
        );
      } else {
        encoder.pushU8(1);
        encoder.pushSmallVec(
          accountConstraint.kind.dataConstraints,
          (dataConstraint) => encodeDataConstraint(encoder, dataConstraint)
        );
      }
      encoder.pushOption(accountConstraint.ownerIndex, (ownerIndex) =>
        encoder.pushU8(ownerIndex)
      );
    });
    encoder.pushSmallVec(constraint.dataConstraints, (dataConstraint) =>
      encodeDataConstraint(encoder, dataConstraint)
    );
  });
  encoder.pushOption<never>(undefined, () => undefined);
  encoder.pushOption<never>(undefined, () => undefined);
  encoder.pushSmallVec([], () => undefined);
}

function encodeDataConstraint(
  encoder: BytesEncoder,
  constraint: DataConstraint
): void {
  encoder.pushU64(constraint.dataOffset);
  switch (constraint.dataValue.type) {
    case "u8":
      encoder.pushU8(0);
      encoder.pushU8(constraint.dataValue.value);
      break;
    case "u16Le":
      encoder.pushU8(1);
      encoder.pushU16(constraint.dataValue.value);
      break;
    case "u32Le":
      encoder.pushU8(2);
      encoder.pushU32(constraint.dataValue.value);
      break;
    case "u64Le":
      encoder.pushU8(3);
      encoder.pushU64(constraint.dataValue.value);
      break;
    case "u128Le":
      encoder.pushU8(4);
      encoder.pushU64(
        constraint.dataValue.value & BigInt("0xffffffffffffffff")
      );
      encoder.pushU64(constraint.dataValue.value >> BigInt(64));
      break;
    case "u8Slice":
      encoder.pushU8(5);
      encoder.pushVec(constraint.dataValue.value, (byte) =>
        encoder.pushU8(byte)
      );
      break;
  }
  encoder.pushU8(operatorTag(constraint.operator));
}

function operatorTag(operator: DataConstraint["operator"]): number {
  switch (operator) {
    case "equals":
      return 0;
    case "notEquals":
      return 1;
    case "greaterThan":
      return 2;
    case "greaterThanOrEqualTo":
      return 3;
    case "lessThan":
      return 4;
    case "lessThanOrEqualTo":
      return 5;
  }
}
