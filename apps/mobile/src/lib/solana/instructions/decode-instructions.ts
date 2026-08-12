import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { Buffer } from "buffer";

import {
  isKnownProgram,
  KNOWN_PROGRAMS,
  programDisplayName,
  truncateAddress,
} from "./known-programs";

export type DecodedInstruction = {
  program: string;
  description: string;
};

type ParsedInstruction = {
  programId: PublicKey;
  keys: { pubkey: PublicKey }[];
  data: Buffer;
};

function extractInstructions(
  tx: Transaction | VersionedTransaction
): ParsedInstruction[] {
  if (tx instanceof VersionedTransaction) {
    const staticKeys = tx.message.staticAccountKeys;
    return tx.message.compiledInstructions.map((ix) => ({
      programId:
        staticKeys[ix.programIdIndex] ?? new PublicKey(new Uint8Array(32)),
      keys: ix.accountKeyIndexes.map((idx) => ({
        pubkey: staticKeys[idx] ?? new PublicKey(new Uint8Array(32)),
      })),
      data: Buffer.from(ix.data),
    }));
  }

  return tx.instructions.map((ix) => ({
    programId: ix.programId,
    keys: ix.keys.map((k) => ({ pubkey: k.pubkey })),
    data: Buffer.from(ix.data),
  }));
}

function describeSystemTransfer(
  ix: ParsedInstruction
): DecodedInstruction | null {
  try {
    const decoded = SystemInstruction.decodeTransfer({
      programId: ix.programId,
      keys: ix.keys.map((k) => ({
        pubkey: k.pubkey,
        isSigner: false,
        isWritable: true,
      })),
      data: ix.data,
    } as never);
    const sol = Number(decoded.lamports) / LAMPORTS_PER_SOL;
    return {
      program: "System Program",
      description: `Transfer ${sol} SOL to ${truncateAddress(
        decoded.toPubkey.toBase58()
      )}`,
    };
  } catch {
    return null;
  }
}

function summarizeInstruction(ix: ParsedInstruction): DecodedInstruction {
  const progAddr = ix.programId.toBase58();

  if (progAddr === SystemProgram.programId.toBase58()) {
    const transfer = describeSystemTransfer(ix);
    if (transfer) return transfer;
  }

  const name = programDisplayName(progAddr);
  return {
    program: name,
    description: isKnownProgram(progAddr)
      ? `${name} instruction`
      : `Instruction to ${name}`,
  };
}

export function decodeTransactionInstructions(
  tx: Transaction | VersionedTransaction
): DecodedInstruction[] {
  return extractInstructions(tx).map(summarizeInstruction);
}

export function deserializeTransaction(
  bytes: Uint8Array
): Transaction | VersionedTransaction {
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(bytes);
  }
}

export function decodeTransactionBase64(base64: string): DecodedInstruction[] {
  try {
    const bytes = Buffer.from(base64, "base64");
    const tx = deserializeTransaction(bytes);
    return decodeTransactionInstructions(tx);
  } catch {
    return [
      { program: "Unknown", description: "Failed to decode transaction" },
    ];
  }
}

const PRINTABLE_ASCII_RE = /^[\x20-\x7E\n\r\t]+$/;

function bytesToHex(bytes: Uint8Array): string {
  const out = new Array<string>(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i].toString(16).padStart(2, "0");
  }
  return out.join(" ");
}

export function decodeMessageBytes(bytes: Uint8Array): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (PRINTABLE_ASCII_RE.test(text)) return text;
    return bytesToHex(bytes);
  } catch {
    return bytesToHex(bytes);
  }
}

export function decodeMessageBase64(base64: string): string {
  const bytes = Buffer.from(base64, "base64");
  return decodeMessageBytes(new Uint8Array(bytes));
}

export { KNOWN_PROGRAMS, programDisplayName, truncateAddress };
