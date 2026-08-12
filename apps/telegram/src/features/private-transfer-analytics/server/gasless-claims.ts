import "server-only";

import { gaslessClaimTransactions } from "@loyal-labs/db-core/schema";
import type {
  ParsedInstruction,
  ParsedMessage,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
} from "@solana/web3.js";
import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { sql } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";
import { decodeTelegramVerificationInstruction } from "@/lib/solana/solana-helpers";

import type {
  GaslessClaimSolanaEnv,
  GaslessClaimTransactionInput,
  GaslessClaimTransactionType,
} from "../types";
import {
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  ED25519_PROGRAM_ID,
  PARSED_TX_BATCH_SIZE,
  RECIPIENT_TARGET_LAMPORTS,
} from "./constants";

const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const PARSED_TX_RETRIES = 6;
const PARSED_TX_DELAY_MS = 350;

type SupportedInstruction = ParsedInstruction | PartiallyDecodedInstruction;

type ClassificationResult =
  | {
      recipientAddress: string | null;
      transactionType: GaslessClaimTransactionType;
    }
  | { skipReason: "excludedBpfLoader" | "missingBlockTime" | "unclassified" };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function accountKeyToString(
  key: ParsedMessage["accountKeys"][number] | PublicKey | string
): string {
  if (typeof key === "string") {
    return key;
  }
  if ("pubkey" in (key as ParsedMessage["accountKeys"][number])) {
    return (key as ParsedMessage["accountKeys"][number]).pubkey.toString();
  }
  return key.toString();
}

function instructionProgramIdToString(
  instruction: SupportedInstruction
): string {
  const programId = (instruction as { programId?: PublicKey | string })
    .programId;
  if (programId instanceof PublicKey) {
    return programId.toBase58();
  }
  return typeof programId === "string" ? programId : "";
}

function decodeUpgradeableLoaderInstructionName(data: string): string | null {
  try {
    const bytes = bs58.decode(data);
    if (bytes.length < 4) {
      return null;
    }

    const discriminator = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength
    ).getUint32(0, true);

    const instructionNames: Record<number, string> = {
      0: "initialize_buffer",
      1: "write",
      2: "deploy",
      3: "upgrade",
      4: "set_authority",
      5: "close",
      6: "extend_program",
      7: "set_authority_checked",
    };

    return instructionNames[discriminator] ?? `unknown_${discriminator}`;
  } catch {
    return null;
  }
}

function getOuterInstructions(
  transaction: ParsedTransactionWithMeta
): SupportedInstruction[] {
  return transaction.transaction.message.instructions as SupportedInstruction[];
}

function getDecodedVerificationInstructionNames(
  transaction: ParsedTransactionWithMeta
): string[] {
  return getOuterInstructions(transaction)
    .filter(
      (instruction): instruction is PartiallyDecodedInstruction =>
        "data" in instruction && typeof instruction.data === "string"
    )
    .map((instruction) => {
      try {
        return (
          decodeTelegramVerificationInstruction(instruction.data)?.name ?? null
        );
      } catch {
        return null;
      }
    })
    .filter((name): name is string => name !== null);
}

function isExcludedBpfLoaderTransaction(
  transaction: ParsedTransactionWithMeta
): boolean {
  return getOuterInstructions(transaction)
    .filter(
      (instruction): instruction is PartiallyDecodedInstruction =>
        instructionProgramIdToString(instruction) ===
          BPF_LOADER_UPGRADEABLE_PROGRAM_ID.toBase58() &&
        "data" in instruction &&
        typeof instruction.data === "string"
    )
    .some((instruction) => {
      const name = decodeUpgradeableLoaderInstructionName(instruction.data);
      return name === "write" || name === "upgrade" || name === "deploy";
    });
}

function getTopUpRecipientAddress(
  transaction: ParsedTransactionWithMeta,
  payerAddress: string
): string | null {
  const instructions = getOuterInstructions(transaction);
  if (instructions.length !== 1) {
    return null;
  }

  const instruction = instructions[0];
  if (
    !instruction ||
    instructionProgramIdToString(instruction) !== SYSTEM_PROGRAM_ID
  ) {
    return null;
  }

  if (!("parsed" in instruction)) {
    return null;
  }

  const parsedInfo = (
    instruction as ParsedInstruction & {
      parsed?: { info?: { destination?: string; source?: string } };
    }
  ).parsed?.info;

  if (!parsedInfo?.destination || parsedInfo.source !== payerAddress) {
    return null;
  }

  const accountKeys = transaction.transaction.message.accountKeys.map(
    (accountKey) => accountKeyToString(accountKey)
  );
  const recipientIndex = accountKeys.indexOf(parsedInfo.destination);
  if (recipientIndex < 0) {
    return null;
  }

  const recipientPostBalance = transaction.meta?.postBalances?.[recipientIndex];
  return recipientPostBalance === RECIPIENT_TARGET_LAMPORTS
    ? parsedInfo.destination
    : null;
}

function calculateSpentLamports(
  transaction: ParsedTransactionWithMeta,
  payerAddress: string
): string | null {
  if (!transaction.meta) {
    return null;
  }

  const accountKeys = transaction.transaction.message.accountKeys.map(
    (accountKey) => accountKeyToString(accountKey)
  );
  const payerIndex = accountKeys.indexOf(payerAddress);
  if (payerIndex < 0) {
    return null;
  }

  const preBalance = transaction.meta.preBalances?.[payerIndex];
  const postBalance = transaction.meta.postBalances?.[payerIndex];
  if (typeof preBalance !== "number" || typeof postBalance !== "number") {
    return null;
  }

  const spentLamports = Math.max(0, preBalance - postBalance);
  return String(spentLamports);
}

export function classifyGaslessClaimTransaction(
  transaction: ParsedTransactionWithMeta,
  payerAddress: string
): ClassificationResult {
  if (transaction.blockTime === null || transaction.blockTime === undefined) {
    return { skipReason: "missingBlockTime" };
  }

  if (isExcludedBpfLoaderTransaction(transaction)) {
    return { skipReason: "excludedBpfLoader" };
  }

  const topUpRecipientAddress = getTopUpRecipientAddress(
    transaction,
    payerAddress
  );
  if (topUpRecipientAddress) {
    return {
      recipientAddress: topUpRecipientAddress,
      transactionType: "top_up_to_0_01_sol",
    };
  }

  const decodedVerificationInstructionNames =
    getDecodedVerificationInstructionNames(transaction);

  if (decodedVerificationInstructionNames.includes("store")) {
    return {
      recipientAddress: null,
      transactionType: "store",
    };
  }

  const hasEd25519Instruction = getOuterInstructions(transaction).some(
    (instruction) =>
      instructionProgramIdToString(instruction) ===
      ED25519_PROGRAM_ID.toBase58()
  );
  if (
    hasEd25519Instruction &&
    decodedVerificationInstructionNames.includes("verify_telegram_init_data")
  ) {
    return {
      recipientAddress: null,
      transactionType: "verify_telegram_init_data",
    };
  }

  return { skipReason: "unclassified" };
}

export function buildGaslessClaimTransactionInput(args: {
  payerAddress: string;
  recipientAddress: string | null;
  signature: string;
  solanaEnv: GaslessClaimSolanaEnv;
  transaction: ParsedTransactionWithMeta;
  transactionType: GaslessClaimTransactionType;
}): GaslessClaimTransactionInput | null {
  const spentLamports = calculateSpentLamports(
    args.transaction,
    args.payerAddress
  );
  if (!spentLamports || !args.transaction.blockTime) {
    return null;
  }

  return {
    occurredAt: new Date(args.transaction.blockTime * 1000),
    payerAddress: args.payerAddress,
    recipientAddress: args.recipientAddress,
    signature: args.signature,
    slot: BigInt(args.transaction.slot),
    solanaEnv: args.solanaEnv,
    spentLamports,
    transactionType: args.transactionType,
  };
}

export async function upsertGaslessClaimTransactions(
  rows: GaslessClaimTransactionInput[]
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  const db = getDatabase();
  const affected = await db
    .insert(gaslessClaimTransactions)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        gaslessClaimTransactions.solanaEnv,
        gaslessClaimTransactions.signature,
      ],
      set: {
        occurredAt: sql`excluded.occurred_at`,
        payerAddress: sql`excluded.payer_address`,
        recipientAddress: sql`excluded.recipient_address`,
        slot: sql`excluded.slot`,
        spentLamports: sql`excluded.spent_lamports`,
        transactionType: sql`excluded.transaction_type`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: gaslessClaimTransactions.id });

  return affected.length;
}

export async function fetchParsedTransactionWithRetry(
  connection: Connection,
  signature: string
): Promise<ParsedTransactionWithMeta | null> {
  for (let attempt = 0; attempt < PARSED_TX_RETRIES; attempt += 1) {
    try {
      const parsedTransaction = await connection.getParsedTransaction(
        signature,
        {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        }
      );
      if (parsedTransaction) {
        return parsedTransaction;
      }
    } catch (error) {
      if (attempt === PARSED_TX_RETRIES - 1) {
        throw error;
      }
    }

    await sleep(PARSED_TX_DELAY_MS * (attempt + 1));
  }

  return null;
}

export async function fetchParsedTransactionsForSignatures(
  connection: Connection,
  signatures: string[]
): Promise<(ParsedTransactionWithMeta | null)[]> {
  const parsedTransactions: (ParsedTransactionWithMeta | null)[] = [];

  for (
    let index = 0;
    index < signatures.length;
    index += PARSED_TX_BATCH_SIZE
  ) {
    const batch = signatures.slice(index, index + PARSED_TX_BATCH_SIZE);
    parsedTransactions.push(
      ...(await connection.getParsedTransactions(batch, {
        maxSupportedTransactionVersion: 0,
      }))
    );
  }

  return parsedTransactions;
}

export async function recordGaslessClaimTransactionBySignature(args: {
  connection: Connection;
  payerAddress: string;
  recipientAddress?: string | null;
  signature: string;
  solanaEnv: GaslessClaimSolanaEnv;
  transactionType: GaslessClaimTransactionType;
}): Promise<void> {
  const parsedTransaction = await fetchParsedTransactionWithRetry(
    args.connection,
    args.signature
  );
  if (!parsedTransaction) {
    throw new Error(
      `Unable to load parsed transaction for gasless analytics: ${args.signature}`
    );
  }

  const row = buildGaslessClaimTransactionInput({
    payerAddress: args.payerAddress,
    recipientAddress: args.recipientAddress ?? null,
    signature: args.signature,
    solanaEnv: args.solanaEnv,
    transaction: parsedTransaction,
    transactionType: args.transactionType,
  });
  if (!row) {
    throw new Error(
      `Unable to derive gasless analytics row for signature ${args.signature}`
    );
  }

  await upsertGaslessClaimTransactions([row]);
}
