import "server-only";

import bs58 from "bs58";
import { readFileSync } from "node:fs";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  decodeCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  type AddressLookupTableAccount,
  Keypair,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import { generated } from "@loyal-labs/loyal-smart-accounts";

import { getServerEnv } from "@/lib/core/config/server";
import { resolveLoyalWebSolanaEnvFromEnv } from "@/lib/core/config/solana-env-override";
import { getServerSolanaConnection } from "@/lib/solana/rpc-connection.server";

const SEND_ATTEMPTS = 3;
const STATUS_POLL_ATTEMPTS = 12;
const STATUS_POLL_DELAY_MS = 1_000;
const SOLANA_TRANSACTION_PACKET_DATA_SIZE = 1232;
const MAX_SPONSORED_SYSTEM_RENT_TRANSFER_LAMPORTS = BigInt(39_532_800);

let cachedSponsorKeypair: Keypair | null = null;
let cachedSponsorPrivateKey: string | null = null;
let cachedSponsorPrivateKeyFile: string | null = null;

type SponsoredTransaction = Transaction | VersionedTransaction;

export type SponsoredTransactionGuardContext = {
  allowedAssociatedTokenMints?: readonly PublicKey[];
  allowedAssociatedTokenOwners?: readonly PublicKey[];
  allowedSmartAccountRentAccounts?: readonly PublicKey[];
  allowedSmartAccountsProgramId?: PublicKey;
  allowedSubscriptionRentAccounts?: readonly PublicKey[];
  allowedSubscriptionsProgramId?: PublicKey;
  allowedSystemTransferDestinations?: readonly PublicKey[];
  allowedTokenCloseAccounts?: readonly PublicKey[];
  requireSponsorFeePayer?: boolean;
};

export type SponsoredTransactionConfirmation = {
  confirmedSlot: string;
  signature: string;
};

export type EarnPolicySponsorPrefundConfirmation = {
  balanceLamports: string;
  confirmedSlot?: string;
  destination: string;
  lamports: string;
  requiredLamports: string;
  signature?: string;
  status: "skipped" | "transferred";
};

export class EarnPolicySponsoredTransactionError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(args: { status: number; code: string; message: string }) {
    super(args.message);
    this.name = "EarnPolicySponsoredTransactionError";
    this.status = args.status;
    this.code = args.code;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodePrivateKey(value: string): Uint8Array {
  const trimmed = value.trim();

  if (trimmed.startsWith("[")) {
    return Uint8Array.from(JSON.parse(trimmed) as number[]);
  }

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Uint8Array.from(
      trimmed.match(/../g)!.map((byte) => Number.parseInt(byte, 16))
    );
  }

  return bs58.decode(trimmed);
}

function getEarnPolicySponsorPrivateKey(): {
  privateKey: string | undefined;
  privateKeyFile: string | null;
} {
  const privateKeyFile = process.env.EARN_POLICY_SPONSOR_PK_FILE?.trim();
  if (privateKeyFile) {
    return {
      privateKey: readFileSync(privateKeyFile, "utf8"),
      privateKeyFile,
    };
  }

  const privateKey = getServerEnv().earnPolicySponsorPrivateKey;
  return { privateKey, privateKeyFile: null };
}

function getEarnPolicySponsorKeypair(): Keypair {
  const { privateKey, privateKeyFile } = getEarnPolicySponsorPrivateKey();
  if (!privateKey) {
    throw new EarnPolicySponsoredTransactionError({
      status: 500,
      code: "earn_policy_sponsor_not_configured",
      message:
        "EARN_POLICY_SPONSOR_PK or EARN_POLICY_SPONSOR_PK_FILE is not set.",
    });
  }

  if (
    cachedSponsorKeypair &&
    cachedSponsorPrivateKey === privateKey &&
    cachedSponsorPrivateKeyFile === privateKeyFile
  ) {
    return cachedSponsorKeypair;
  }

  const privateKeyBytes = decodePrivateKey(privateKey);
  cachedSponsorKeypair =
    privateKeyBytes.length === 32
      ? Keypair.fromSeed(privateKeyBytes)
      : Keypair.fromSecretKey(privateKeyBytes);
  cachedSponsorPrivateKey = privateKey;
  cachedSponsorPrivateKeyFile = privateKeyFile;
  return cachedSponsorKeypair;
}

function deserializeTransaction(value: string): SponsoredTransaction {
  const bytes = Buffer.from(value, "base64");

  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    try {
      return Transaction.from(bytes);
    } catch {
      throw new EarnPolicySponsoredTransactionError({
        status: 400,
        code: "invalid_transaction",
        message: "Sponsored transaction must be a base64 Solana transaction.",
      });
    }
  }
}

function getTransactionFeePayer(transaction: SponsoredTransaction): PublicKey {
  if (transaction instanceof VersionedTransaction) {
    const feePayer = transaction.message.staticAccountKeys[0];
    if (!feePayer) {
      throw new EarnPolicySponsoredTransactionError({
        status: 400,
        code: "invalid_fee_payer",
        message: "Sponsored transaction fee payer is missing.",
      });
    }
    return feePayer;
  }

  const feePayer =
    transaction.feePayer ?? transaction.compileMessage().accountKeys[0];
  if (!feePayer) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "invalid_fee_payer",
      message: "Sponsored transaction fee payer is missing.",
    });
  }
  return feePayer;
}

async function resolveAddressLookupTableAccounts(args: {
  connection: Connection;
  transaction: VersionedTransaction;
}): Promise<AddressLookupTableAccount[]> {
  const accounts: AddressLookupTableAccount[] = [];

  for (const lookup of args.transaction.message.addressTableLookups) {
    const { value } = await args.connection.getAddressLookupTable(
      lookup.accountKey
    );
    if (!value) {
      throw new EarnPolicySponsoredTransactionError({
        status: 400,
        code: "address_lookup_table_not_found",
        message: `Address lookup table not found: ${lookup.accountKey.toBase58()}`,
      });
    }
    accounts.push(value);
  }

  return accounts;
}

function publicKeyInList(
  value: PublicKey,
  candidates: readonly PublicKey[] | undefined
): boolean {
  return Boolean(candidates?.some((candidate) => candidate.equals(value)));
}

function instructionDataStartsWith(
  data: Uint8Array,
  prefix: readonly number[]
): boolean {
  if (data.length < prefix.length) {
    return false;
  }

  return prefix.every((byte, index) => data[index] === byte);
}

function buildTransactionInstruction(args: {
  accountIndexes: readonly number[];
  data: Uint8Array;
  getKey: (index: number) => PublicKey | undefined;
  isSigner: (index: number) => boolean;
  isWritable: (index: number) => boolean;
  programId: PublicKey;
}): TransactionInstruction | null {
  const keys = args.accountIndexes.map((index) => {
    const pubkey = args.getKey(index);
    if (!pubkey) {
      return null;
    }

    return {
      pubkey,
      isSigner: args.isSigner(index),
      isWritable: args.isWritable(index),
    };
  });

  if (keys.some((key) => key === null)) {
    return null;
  }

  return new TransactionInstruction({
    data: Buffer.from(args.data),
    keys: keys as NonNullable<(typeof keys)[number]>[],
    programId: args.programId,
  });
}

function isAllowedAssociatedTokenRentInstruction(args: {
  guard: SponsoredTransactionGuardContext;
  instruction: TransactionInstruction;
  sponsor: PublicKey;
}): boolean {
  const { guard, instruction, sponsor } = args;
  if (!instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
    return false;
  }
  if (instruction.data.length !== 1 || instruction.data[0] !== 1) {
    return false;
  }

  const payer = instruction.keys[0];
  const associatedTokenAccount = instruction.keys[1];
  const owner = instruction.keys[2];
  const mint = instruction.keys[3];
  const tokenProgram = instruction.keys[5];
  if (
    !payer?.pubkey.equals(sponsor) ||
    !payer.isSigner ||
    !payer.isWritable ||
    !associatedTokenAccount ||
    !owner ||
    !mint ||
    !tokenProgram ||
    !publicKeyInList(owner.pubkey, guard.allowedAssociatedTokenOwners) ||
    !publicKeyInList(mint.pubkey, guard.allowedAssociatedTokenMints)
  ) {
    return false;
  }

  try {
    const expectedAssociatedTokenAccount = getAssociatedTokenAddressSync(
      mint.pubkey,
      owner.pubkey,
      true,
      tokenProgram.pubkey
    );
    return associatedTokenAccount.pubkey.equals(expectedAssociatedTokenAccount);
  } catch {
    return false;
  }
}

function isAllowedSystemRentTransferInstruction(args: {
  guard: SponsoredTransactionGuardContext;
  instruction: TransactionInstruction;
  sponsor: PublicKey;
}): boolean {
  const { guard, instruction, sponsor } = args;
  if (!instruction.programId.equals(SystemProgram.programId)) {
    return false;
  }
  if (!instruction.keys[0]?.pubkey.equals(sponsor)) {
    return false;
  }

  try {
    const transfer = SystemInstruction.decodeTransfer(instruction);
    const lamports = BigInt(transfer.lamports.toString());
    return (
      transfer.fromPubkey.equals(sponsor) &&
      publicKeyInList(
        transfer.toPubkey,
        guard.allowedSystemTransferDestinations
      ) &&
      lamports > BigInt(0) &&
      lamports <= MAX_SPONSORED_SYSTEM_RENT_TRANSFER_LAMPORTS
    );
  } catch {
    return false;
  }
}

function isAllowedTokenCloseRentInstruction(args: {
  guard: SponsoredTransactionGuardContext;
  instruction: TransactionInstruction;
  sponsor: PublicKey;
}): boolean {
  const { guard, instruction, sponsor } = args;
  if (!instruction.programId.equals(TOKEN_PROGRAM_ID)) {
    return false;
  }

  try {
    const close = decodeCloseAccountInstruction(instruction, TOKEN_PROGRAM_ID);
    return (
      close.keys.destination.pubkey.equals(sponsor) &&
      publicKeyInList(
        close.keys.account.pubkey,
        guard.allowedTokenCloseAccounts
      )
    );
  } catch {
    return false;
  }
}

function isAllowedSmartAccountRentInstruction(args: {
  guard: SponsoredTransactionGuardContext;
  instruction: TransactionInstruction;
  sponsor: PublicKey;
}): boolean {
  const { guard, instruction, sponsor } = args;
  const programId = guard.allowedSmartAccountsProgramId;
  if (!programId || !instruction.programId.equals(programId)) {
    return false;
  }
  if (
    !instructionDataStartsWith(
      instruction.data,
      generated.executeSettingsTransactionSyncInstructionDiscriminator
    )
  ) {
    return false;
  }

  const rentPayer = instruction.keys[1];
  if (
    !rentPayer?.pubkey.equals(sponsor) ||
    !rentPayer.isSigner ||
    !rentPayer.isWritable
  ) {
    return false;
  }

  const declaredProgram = instruction.keys[3];
  if (!declaredProgram?.pubkey.equals(programId)) {
    return false;
  }

  return Boolean(
    guard.allowedSmartAccountRentAccounts?.some((account) =>
      instruction.keys.some(
        (key) => key.pubkey.equals(account) && key.isWritable
      )
    )
  );
}

function parseSyncV2CompiledInstructions(data: Uint8Array): Array<{
  accountIndexes: number[];
  data: Uint8Array;
  programIdIndex: number;
}> | null {
  const instructions: Array<{
    accountIndexes: number[];
    data: Uint8Array;
    programIdIndex: number;
  }> = [];
  let offset = 0;
  const instructionCount = data[offset];
  if (instructionCount === undefined) {
    return null;
  }
  offset += 1;

  for (let index = 0; index < instructionCount; index += 1) {
    const programIdIndex = data[offset];
    const accountCount = data[offset + 1];
    if (programIdIndex === undefined || accountCount === undefined) {
      return null;
    }
    offset += 2;

    if (offset + accountCount > data.length) {
      return null;
    }
    const accountIndexes = Array.from(
      data.slice(offset, offset + accountCount)
    );
    offset += accountCount;

    if (offset + 2 > data.length) {
      return null;
    }
    const instructionDataLength = data[offset] | (data[offset + 1]! << 8);
    offset += 2;

    if (offset + instructionDataLength > data.length) {
      return null;
    }
    const instructionData = data.slice(offset, offset + instructionDataLength);
    offset += instructionDataLength;

    instructions.push({
      accountIndexes,
      data: instructionData,
      programIdIndex,
    });
  }

  return offset === data.length ? instructions : null;
}

function isAllowedSmartAccountWrappedTokenCloseRentInstruction(args: {
  guard: SponsoredTransactionGuardContext;
  instruction: TransactionInstruction;
  sponsor: PublicKey;
}): boolean {
  const { guard, instruction, sponsor } = args;
  const programId = guard.allowedSmartAccountsProgramId;
  if (!programId || !instruction.programId.equals(programId)) {
    return false;
  }
  if (
    !instructionDataStartsWith(
      instruction.data,
      generated.executeTransactionSyncV2InstructionDiscriminator
    )
  ) {
    return false;
  }

  const sponsorMeta = instruction.keys.find((key) =>
    key.pubkey.equals(sponsor)
  );
  if (!sponsorMeta?.isSigner || !sponsorMeta.isWritable) {
    return false;
  }

  let decoded:
    | {
        args?: {
          numSigners?: number;
          payload?: {
            __kind?: string;
            fields?: unknown[];
          };
        };
      }
    | undefined;
  try {
    [decoded] = generated.executeTransactionSyncV2Struct.deserialize(
      Buffer.from(instruction.data)
    );
  } catch {
    return false;
  }

  const payload = decoded?.args?.payload;
  if (payload?.__kind !== "Transaction") {
    return false;
  }
  const payloadBytes = payload.fields?.[0];
  if (!(payloadBytes instanceof Uint8Array)) {
    return false;
  }

  const memberCount = decoded?.args?.numSigners;
  if (
    typeof memberCount !== "number" ||
    !Number.isInteger(memberCount) ||
    memberCount < 0
  ) {
    return false;
  }
  const remainingAccountOffset = 2 + memberCount;
  const getInnerAccount = (index: number) =>
    instruction.keys[remainingAccountOffset + index];

  const innerInstructions = parseSyncV2CompiledInstructions(payloadBytes);
  if (!innerInstructions) {
    return false;
  }

  let hasAllowedSponsorReference = false;
  for (const innerInstruction of innerInstructions) {
    const innerProgram = getInnerAccount(innerInstruction.programIdIndex);
    if (!innerProgram) {
      return false;
    }
    const referencesSponsor =
      innerProgram.pubkey.equals(sponsor) ||
      innerInstruction.accountIndexes.some((index) =>
        getInnerAccount(index)?.pubkey.equals(sponsor)
      );
    if (!referencesSponsor) {
      continue;
    }

    const transactionInstruction = buildTransactionInstruction({
      accountIndexes: innerInstruction.accountIndexes,
      data: innerInstruction.data,
      getKey: (index) => getInnerAccount(index)?.pubkey,
      isSigner: (index) => getInnerAccount(index)?.isSigner ?? false,
      isWritable: (index) => getInnerAccount(index)?.isWritable ?? false,
      programId: innerProgram.pubkey,
    });
    if (!transactionInstruction) {
      return false;
    }
    const isAllowed = isAllowedTokenCloseRentInstruction({
      guard,
      instruction: transactionInstruction,
      sponsor,
    });
    if (!isAllowed) {
      return false;
    }
    hasAllowedSponsorReference = true;
  }

  return hasAllowedSponsorReference;
}

function isAllowedSubscriptionRentInstruction(args: {
  guard: SponsoredTransactionGuardContext;
  instruction: TransactionInstruction;
  sponsor: PublicKey;
}): boolean {
  const { guard, instruction, sponsor } = args;
  const programId = guard.allowedSubscriptionsProgramId;
  if (!programId || !instruction.programId.equals(programId)) {
    return false;
  }
  const opcode = instruction.data[0];
  if (opcode !== 0 && opcode !== 2) {
    return false;
  }

  const rentPayer = instruction.keys[instruction.keys.length - 1];
  if (
    !rentPayer?.pubkey.equals(sponsor) ||
    !rentPayer.isSigner ||
    !rentPayer.isWritable
  ) {
    return false;
  }

  const rentAccount = instruction.keys[opcode === 0 ? 1 : 2];
  return Boolean(
    rentAccount?.isWritable &&
      guard.allowedSubscriptionRentAccounts?.some((account) =>
        account.equals(rentAccount.pubkey)
      )
  );
}

function isAllowedSponsorInstructionReference(args: {
  guard: SponsoredTransactionGuardContext;
  instruction: TransactionInstruction;
  sponsor: PublicKey;
}): boolean {
  return (
    isAllowedAssociatedTokenRentInstruction(args) ||
    isAllowedSystemRentTransferInstruction(args) ||
    isAllowedTokenCloseRentInstruction(args) ||
    isAllowedSmartAccountRentInstruction(args) ||
    isAllowedSmartAccountWrappedTokenCloseRentInstruction(args) ||
    isAllowedSubscriptionRentInstruction(args)
  );
}

async function assertSponsorUsageAllowed(args: {
  connection: Connection;
  guard?: SponsoredTransactionGuardContext;
  sponsor: PublicKey;
  transaction: SponsoredTransaction;
}) {
  const guard = args.guard ?? {};
  const requireSponsorFeePayer = guard.requireSponsorFeePayer ?? true;
  const feePayer = getTransactionFeePayer(args.transaction);
  if (requireSponsorFeePayer && !feePayer.equals(args.sponsor)) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "fee_payer_mismatch",
      message: "Sponsored transaction fee payer does not match the sponsor.",
    });
  }
  if (!requireSponsorFeePayer && feePayer.equals(args.sponsor)) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "fee_payer_mismatch",
      message:
        "Non-sponsored transaction fee payer must not match the sponsor.",
    });
  }

  if (args.transaction instanceof VersionedTransaction) {
    const transaction = args.transaction;
    let accountKeys;
    try {
      accountKeys = transaction.message.getAccountKeys({
        addressLookupTableAccounts: await resolveAddressLookupTableAccounts({
          connection: args.connection,
          transaction,
        }),
      });
    } catch (error) {
      if (error instanceof EarnPolicySponsoredTransactionError) {
        throw error;
      }
      throw new EarnPolicySponsoredTransactionError({
        status: 400,
        code: "invalid_address_lookup_table",
        message:
          error instanceof Error
            ? error.message
            : "Sponsored transaction address lookup tables are invalid.",
      });
    }

    const sponsorIndexes: number[] = [];
    for (let index = 0; index < accountKeys.length; index += 1) {
      const key = accountKeys.get(index);
      if (key?.equals(args.sponsor)) {
        sponsorIndexes.push(index);
      }
    }
    if (requireSponsorFeePayer && sponsorIndexes.some((index) => index !== 0)) {
      throw new EarnPolicySponsoredTransactionError({
        status: 400,
        code: "sponsor_not_approved_payer",
        message:
          "Earn policy sponsor must only appear as the transaction fee payer.",
      });
    }

    let hasAllowedSponsorInstructionReference = false;
    const sponsorInstructionReference =
      transaction.message.compiledInstructions.find((instruction) => {
        const programId = accountKeys.get(instruction.programIdIndex);
        if (!programId) {
          return true;
        }
        if (programId.equals(args.sponsor)) {
          return true;
        }

        const referencesSponsor = instruction.accountKeyIndexes.some((index) =>
          accountKeys.get(index)?.equals(args.sponsor)
        );
        if (!referencesSponsor) {
          return false;
        }

        const transactionInstruction = buildTransactionInstruction({
          accountIndexes: instruction.accountKeyIndexes,
          data: instruction.data,
          getKey: (index) => accountKeys.get(index),
          isSigner: (index) => transaction.message.isAccountSigner(index),
          isWritable: (index) => transaction.message.isAccountWritable(index),
          programId,
        });
        if (!transactionInstruction) {
          return true;
        }
        const isAllowed = isAllowedSponsorInstructionReference({
          guard,
          instruction: transactionInstruction,
          sponsor: args.sponsor,
        });
        hasAllowedSponsorInstructionReference ||= isAllowed;
        return !isAllowed;
      });
    if (sponsorInstructionReference) {
      throw new EarnPolicySponsoredTransactionError({
        status: 400,
        code: "sponsor_not_approved_payer",
        message:
          "Earn policy sponsor must only be used as fee payer or approved rent payer.",
      });
    }
    if (!requireSponsorFeePayer && !hasAllowedSponsorInstructionReference) {
      throw new EarnPolicySponsoredTransactionError({
        status: 400,
        code: "sponsor_not_approved_payer",
        message: "Earn policy sponsor must be used as an approved rent payer.",
      });
    }
    return;
  }

  const compiled = args.transaction.compileMessage();
  const sponsorIndexes = compiled.accountKeys
    .map((key, index) => (key.equals(args.sponsor) ? index : -1))
    .filter((index) => index >= 0);
  if (requireSponsorFeePayer && sponsorIndexes.some((index) => index !== 0)) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "sponsor_not_approved_payer",
      message:
        "Earn policy sponsor must only appear as the transaction fee payer.",
    });
  }
  let hasAllowedSponsorInstructionReference = false;
  const sponsorInstructionReference = compiled.instructions.find(
    (instruction) => {
      const programId = compiled.accountKeys[instruction.programIdIndex];
      if (!programId) {
        return true;
      }
      if (programId.equals(args.sponsor)) {
        return true;
      }
      const referencesSponsor = instruction.accounts.some((index) =>
        compiled.accountKeys[index]?.equals(args.sponsor)
      );
      if (!referencesSponsor) {
        return false;
      }

      const transactionInstruction = buildTransactionInstruction({
        accountIndexes: instruction.accounts,
        data: bs58.decode(instruction.data),
        getKey: (index) => compiled.accountKeys[index],
        isSigner: (index) => compiled.isAccountSigner(index),
        isWritable: (index) => compiled.isAccountWritable(index),
        programId,
      });
      if (!transactionInstruction) {
        return true;
      }
      const isAllowed = isAllowedSponsorInstructionReference({
        guard,
        instruction: transactionInstruction,
        sponsor: args.sponsor,
      });
      hasAllowedSponsorInstructionReference ||= isAllowed;
      return !isAllowed;
    }
  );
  if (sponsorInstructionReference) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "sponsor_not_approved_payer",
      message:
        "Earn policy sponsor must only be used as fee payer or approved rent payer.",
    });
  }
  if (!requireSponsorFeePayer && !hasAllowedSponsorInstructionReference) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "sponsor_not_approved_payer",
      message: "Earn policy sponsor must be used as an approved rent payer.",
    });
  }
}

function signTransaction(args: {
  sponsor: Keypair;
  transaction: SponsoredTransaction;
}) {
  if (args.transaction instanceof VersionedTransaction) {
    args.transaction.sign([args.sponsor]);
    return;
  }

  args.transaction.partialSign(args.sponsor);
}

function getTransactionSignature(transaction: SponsoredTransaction): string {
  const signature =
    transaction instanceof VersionedTransaction
      ? transaction.signatures[0]
      : transaction.signature;
  if (!signature || signature.every((byte) => byte === 0)) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "missing_sponsor_signature",
      message: "Sponsored transaction is missing the fee payer signature.",
    });
  }
  return bs58.encode(signature);
}

function assertFullySigned(transaction: SponsoredTransaction) {
  const missingSignature =
    transaction instanceof VersionedTransaction
      ? transaction.signatures.some((signature) =>
          signature.every((byte) => byte === 0)
        )
      : transaction.signatures.some(
          (signaturePair) => !signaturePair.signature
        );
  if (missingSignature) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "missing_required_signature",
      message:
        "Sponsored transaction is missing a required non-sponsor signature.",
    });
  }
}

function packetSizeErrorMessage(rawTransactionLength: number): string {
  return `Transaction is ${rawTransactionLength} bytes, which exceeds Solana's ${SOLANA_TRANSACTION_PACKET_DATA_SIZE} byte packet limit. Split the transaction into smaller steps.`;
}

function assertTransactionFitsSolanaPacket(rawTransaction: Uint8Array) {
  if (rawTransaction.length <= SOLANA_TRANSACTION_PACKET_DATA_SIZE) {
    return;
  }

  throw new EarnPolicySponsoredTransactionError({
    status: 413,
    code: "transaction_packet_too_large",
    message: packetSizeErrorMessage(rawTransaction.length),
  });
}

function isTransactionPacketSizeError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : JSON.stringify(error ?? "");
  return (
    /packet/i.test(message) &&
    (/too large/i.test(message) ||
      /exceeds/i.test(message) ||
      /1232/.test(message))
  );
}

async function resolveConfirmedSignatureSlot(args: {
  connection: Connection;
  signature: string;
}): Promise<string | null> {
  const { value } = await args.connection.getSignatureStatuses(
    [args.signature],
    { searchTransactionHistory: true }
  );
  const status = value[0];
  if (!status) {
    return null;
  }
  if (status.err) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "sponsored_transaction_failed",
      message: `Sponsored transaction failed: ${JSON.stringify(status.err)}`,
    });
  }
  if (
    status.confirmationStatus !== "confirmed" &&
    status.confirmationStatus !== "finalized"
  ) {
    return null;
  }
  return status.slot.toString();
}

async function sendAndConfirmSignedTransaction(args: {
  connection: Connection;
  transaction: SponsoredTransaction;
}): Promise<SponsoredTransactionConfirmation> {
  const rawTransaction = args.transaction.serialize();
  assertTransactionFitsSolanaPacket(rawTransaction);
  const signature = getTransactionSignature(args.transaction);
  let lastSendError: unknown = null;

  for (let sendAttempt = 0; sendAttempt < SEND_ATTEMPTS; sendAttempt += 1) {
    try {
      await args.connection.sendRawTransaction(rawTransaction, {
        maxRetries: 3,
        skipPreflight: false,
      });
    } catch (error) {
      if (isTransactionPacketSizeError(error)) {
        throw new EarnPolicySponsoredTransactionError({
          status: 413,
          code: "transaction_packet_too_large",
          message: packetSizeErrorMessage(rawTransaction.length),
        });
      }
      lastSendError = error;
      const confirmedSlot = await resolveConfirmedSignatureSlot({
        connection: args.connection,
        signature,
      });
      if (confirmedSlot) {
        return { confirmedSlot, signature };
      }
    }

    for (
      let statusAttempt = 0;
      statusAttempt < STATUS_POLL_ATTEMPTS;
      statusAttempt += 1
    ) {
      const confirmedSlot = await resolveConfirmedSignatureSlot({
        connection: args.connection,
        signature,
      });
      if (confirmedSlot) {
        return { confirmedSlot, signature };
      }
      await sleep(STATUS_POLL_DELAY_MS);
    }
  }

  throw new EarnPolicySponsoredTransactionError({
    status: 502,
    code: "sponsored_transaction_not_confirmed",
    message:
      lastSendError instanceof Error
        ? lastSendError.message
        : "Sponsored transaction was not confirmed.",
  });
}

export function getEarnPolicySponsorPublicKey(): PublicKey {
  return getEarnPolicySponsorKeypair().publicKey;
}

export async function prefundEarnPolicySponsorDestination(args: {
  destination: PublicKey;
  maxLamports?: bigint;
  requiredLamports: bigint;
}): Promise<EarnPolicySponsorPrefundConfirmation> {
  const maxLamports =
    args.maxLamports ?? MAX_SPONSORED_SYSTEM_RENT_TRANSFER_LAMPORTS;
  if (args.requiredLamports < BigInt(0)) {
    throw new EarnPolicySponsoredTransactionError({
      status: 400,
      code: "invalid_prefund_amount",
      message: "Sponsored pre-fund requirement cannot be negative.",
    });
  }
  if (args.requiredLamports > maxLamports) {
    throw new EarnPolicySponsoredTransactionError({
      status: 413,
      code: "prefund_amount_too_large",
      message:
        "Sponsored pre-fund requirement exceeds the Earn policy sponsorship limit.",
    });
  }

  const sponsor = getEarnPolicySponsorKeypair();
  const connection = getServerSolanaConnection(
    resolveLoyalWebSolanaEnvFromEnv(process.env)
  );
  const balanceLamports = BigInt(
    await connection.getBalance(args.destination, "confirmed")
  );
  if (balanceLamports >= args.requiredLamports) {
    return {
      balanceLamports: balanceLamports.toString(),
      destination: args.destination.toBase58(),
      lamports: "0",
      requiredLamports: args.requiredLamports.toString(),
      status: "skipped",
    };
  }

  const lamports = args.requiredLamports - balanceLamports;
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    blockhash,
    feePayer: sponsor.publicKey,
    lastValidBlockHeight,
  }).add(
    SystemProgram.transfer({
      fromPubkey: sponsor.publicKey,
      lamports: Number(lamports),
      toPubkey: args.destination,
    })
  );
  transaction.sign(sponsor);
  const confirmation = await sendAndConfirmSignedTransaction({
    connection,
    transaction,
  });

  return {
    balanceLamports: balanceLamports.toString(),
    confirmedSlot: confirmation.confirmedSlot,
    destination: args.destination.toBase58(),
    lamports: lamports.toString(),
    requiredLamports: args.requiredLamports.toString(),
    signature: confirmation.signature,
    status: "transferred",
  };
}

export async function executeSponsoredEarnPolicyTransaction(
  serializedTransaction: string,
  guard?: SponsoredTransactionGuardContext
): Promise<SponsoredTransactionConfirmation> {
  const sponsor = getEarnPolicySponsorKeypair();
  const transaction = deserializeTransaction(serializedTransaction);
  const connection = getServerSolanaConnection(
    resolveLoyalWebSolanaEnvFromEnv(process.env)
  );
  await assertSponsorUsageAllowed({
    connection,
    guard,
    sponsor: sponsor.publicKey,
    transaction,
  });
  signTransaction({ sponsor, transaction });
  assertFullySigned(transaction);

  return sendAndConfirmSignedTransaction({
    connection,
    transaction,
  });
}

export async function executeSignedEarnPolicyTransaction(
  serializedTransaction: string
): Promise<SponsoredTransactionConfirmation> {
  const transaction = deserializeTransaction(serializedTransaction);
  const connection = getServerSolanaConnection(
    resolveLoyalWebSolanaEnvFromEnv(process.env)
  );
  assertFullySigned(transaction);

  return sendAndConfirmSignedTransaction({
    connection,
    transaction,
  });
}
