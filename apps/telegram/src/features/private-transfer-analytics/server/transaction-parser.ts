import "server-only";

import type {
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
} from "@solana/web3.js";

import { decodeTelegramPrivateTransferInstruction } from "@/lib/solana/solana-helpers";

import type { PrivateTransferModifyBalanceEventInput } from "../types";
import { PRIVATE_TRANSFER_PROGRAM_ID } from "./constants";

type ParsedModifyBalanceArgs = {
  amount?: { toString(): string };
  increase?: boolean;
};

function isPartiallyDecodedInstruction(
  instruction: unknown
): instruction is PartiallyDecodedInstruction {
  return (
    instruction !== null &&
    typeof instruction === "object" &&
    "programId" in instruction &&
    "accounts" in instruction &&
    "data" in instruction
  );
}

export function parseModifyBalanceEventsFromTransaction(
  tx: ParsedTransactionWithMeta,
  signature: string
): {
  events: PrivateTransferModifyBalanceEventInput[];
  skippedMissingBlockTime: number;
} {
  if (tx.meta?.err) {
    return { events: [], skippedMissingBlockTime: 0 };
  }

  if (!tx.blockTime) {
    return { events: [], skippedMissingBlockTime: 1 };
  }

  const occurredAt = new Date(tx.blockTime * 1000);
  const instructions = tx.transaction.message.instructions;
  const events: PrivateTransferModifyBalanceEventInput[] = [];

  instructions.forEach((instruction, instructionIndex) => {
    if (!isPartiallyDecodedInstruction(instruction)) {
      return;
    }

    if (
      instruction.programId.toBase58() !==
      PRIVATE_TRANSFER_PROGRAM_ID.toBase58()
    ) {
      return;
    }

    const decoded = decodeTelegramPrivateTransferInstruction(instruction.data);
    if (!decoded || decoded.name !== "modify_balance") {
      return;
    }

    const args = (decoded.data as { args?: ParsedModifyBalanceArgs } | null)
      ?.args;
    if (!args?.amount || typeof args.increase !== "boolean") {
      return;
    }

    const accounts = instruction.accounts.map((account) => account.toString());
    if (accounts.length < 7) {
      return;
    }

    const userAddress = accounts[1]?.toString();
    const vaultAddress = accounts[2]?.toString();
    const tokenMint = accounts[6]?.toString();

    events.push({
      amountRaw: args.amount.toString(),
      flow: args.increase ? "shield" : "unshield",
      instructionIndex,
      occurredAt,
      signature,
      slot: BigInt(tx.slot),
      tokenMint,
      userAddress,
      vaultAddress,
    });
  });

  return { events, skippedMissingBlockTime: 0 };
}
