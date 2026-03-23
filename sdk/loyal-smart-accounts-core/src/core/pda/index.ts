import { PublicKey } from "@solana/web3.js";
import invariant from "invariant";
import { PROGRAM_ID } from "../generated/index.js";
import { PDA_REGISTRY } from "../spec/pda-registry.js";
import {
  toU128Bytes,
  toU32Bytes,
  toU64Bytes,
  toU8Bytes,
  toUtfBytes,
} from "../codecs/primitives.js";

type ProgramIdParam = { programId?: PublicKey };
type PdaRegistryKey = keyof typeof PDA_REGISTRY;
type PdaSeedArgs = Record<string, unknown>;

const STATIC_SEED_CACHE = new Map<string, Uint8Array>();

function getStaticSeed(value: string): Uint8Array {
  const cached = STATIC_SEED_CACHE.get(value);
  if (cached) {
    return cached;
  }
  const seed = toUtfBytes(value);
  STATIC_SEED_CACHE.set(value, seed);
  return seed;
}

function derivePda(seeds: Uint8Array[], programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

function toSeedBytes(token: string, args: PdaSeedArgs): Uint8Array {
  if (!token.includes(":")) {
    return getStaticSeed(token);
  }

  const [field, encoding] = token.split(":") as [string, string];
  const value = args[field];
  invariant(value != null, `Missing PDA seed value for "${field}"`);

  switch (encoding) {
    case "pubkey":
      invariant(value instanceof PublicKey, `PDA seed "${field}" must be a PublicKey`);
      return value.toBytes();
    case "u8":
      invariant(typeof value === "number", `PDA seed "${field}" must be a number`);
      return toU8Bytes(value);
    case "u32":
      invariant(typeof value === "number", `PDA seed "${field}" must be a number`);
      return toU32Bytes(value);
    case "u64":
      invariant(
        typeof value === "bigint" || typeof value === "number",
        `PDA seed "${field}" must be a bigint or number`
      );
      return toU64Bytes(typeof value === "bigint" ? value : BigInt(value));
    case "u128":
      invariant(
        typeof value === "bigint" || typeof value === "number",
        `PDA seed "${field}" must be a bigint or number`
      );
      return toU128Bytes(typeof value === "bigint" ? value : BigInt(value));
    default:
      invariant(false, `Unsupported PDA seed encoding "${encoding}"`);
  }
}

function derivePdaFromRegistry(
  key: PdaRegistryKey,
  args: PdaSeedArgs,
  programId: PublicKey
): [PublicKey, number] {
  return derivePda(
    PDA_REGISTRY[key].seeds.map((seed) => toSeedBytes(seed, args)),
    programId
  );
}

export function getProgramConfigPda({
  programId = PROGRAM_ID,
}: ProgramIdParam): [PublicKey, number] {
  return derivePdaFromRegistry("programConfig", {}, programId);
}

export function getSettingsPda({
  accountIndex,
  programId = PROGRAM_ID,
}: ProgramIdParam & { accountIndex: bigint }): [PublicKey, number] {
  return derivePdaFromRegistry("settings", { accountIndex }, programId);
}

export function getSmartAccountPda({
  settingsPda,
  accountIndex,
  programId = PROGRAM_ID,
}: ProgramIdParam & {
  settingsPda: PublicKey;
  accountIndex: number;
}): [PublicKey, number] {
  invariant(accountIndex >= 0 && accountIndex < 256, "Invalid vault index");
  return derivePdaFromRegistry(
    "smartAccount",
    { settingsPda, accountIndex },
    programId
  );
}

export function getEphemeralSignerPda({
  transactionPda,
  ephemeralSignerIndex,
  programId = PROGRAM_ID,
}: ProgramIdParam & {
  transactionPda: PublicKey;
  ephemeralSignerIndex: number;
}): [PublicKey, number] {
  return derivePdaFromRegistry(
    "ephemeralSigner",
    { transactionPda, ephemeralSignerIndex },
    programId
  );
}

export function getTransactionPda({
  settingsPda,
  transactionIndex,
  programId = PROGRAM_ID,
}: ProgramIdParam & {
  settingsPda: PublicKey;
  transactionIndex: bigint;
}): [PublicKey, number] {
  return derivePdaFromRegistry(
    "transaction",
    { settingsPda, transactionIndex },
    programId
  );
}

export function getProposalPda({
  settingsPda,
  transactionIndex,
  programId = PROGRAM_ID,
}: ProgramIdParam & {
  settingsPda: PublicKey;
  transactionIndex: bigint;
}): [PublicKey, number] {
  return derivePdaFromRegistry(
    "proposal",
    { settingsPda, transactionIndex },
    programId
  );
}

export function getBatchTransactionPda({
  settingsPda,
  batchIndex,
  transactionIndex,
  programId = PROGRAM_ID,
}: ProgramIdParam & {
  settingsPda: PublicKey;
  batchIndex: bigint;
  transactionIndex: number;
}): [PublicKey, number] {
  return derivePdaFromRegistry(
    "batchTransaction",
    { settingsPda, batchIndex, transactionIndex },
    programId
  );
}

export function getSpendingLimitPda({
  settingsPda,
  seed,
  programId = PROGRAM_ID,
}: ProgramIdParam & {
  settingsPda: PublicKey;
  seed: PublicKey;
}): [PublicKey, number] {
  return derivePdaFromRegistry("spendingLimit", { settingsPda, seed }, programId);
}

export function getTransactionBufferPda({
  consensusPda,
  creator,
  bufferIndex,
  programId = PROGRAM_ID,
}: ProgramIdParam & {
  consensusPda: PublicKey;
  creator: PublicKey;
  bufferIndex: number;
}): [PublicKey, number] {
  return derivePdaFromRegistry(
    "transactionBuffer",
    { consensusPda, creator, bufferIndex },
    programId
  );
}

export function getPolicyPda({
  settingsPda,
  policySeed,
  programId = PROGRAM_ID,
}: ProgramIdParam & {
  settingsPda: PublicKey;
  policySeed: number;
}): [PublicKey, number] {
  return derivePdaFromRegistry("policy", { settingsPda, policySeed }, programId);
}

export { PDA_REGISTRY };
