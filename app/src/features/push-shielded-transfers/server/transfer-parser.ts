import "server-only";

import type {
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
} from "@solana/web3.js";

import { PRIVATE_TRANSFER_PROGRAM_ID } from "@/features/private-transfer-analytics/server/constants";
import { decodeTelegramPrivateTransferInstruction } from "@/lib/solana/solana-helpers";

import type { TransferDepositEvent } from "../types";

type ParsedTransferDepositArgs = {
  amount?: { toString(): string };
};

// transfer_deposit accounts layout:
//   [0] user (sender)
//   [1] payer
//   [2] source_deposit
//   [3] destination_deposit
//   [4] token_mint
//   [5] system_program
const ACCOUNTS_MIN_LENGTH = 6;
const SOURCE_DEPOSIT_OFFSET_FROM_END = 4;
const DESTINATION_DEPOSIT_OFFSET_FROM_END = 3;
const TOKEN_MINT_OFFSET_FROM_END = 2;

function isPartiallyDecodedInstruction(
  instruction: unknown,
): instruction is PartiallyDecodedInstruction {
  return (
    instruction !== null &&
    typeof instruction === "object" &&
    "programId" in instruction &&
    "accounts" in instruction &&
    "data" in instruction
  );
}

export function parseTransferDepositInstructions(
  tx: ParsedTransactionWithMeta,
  signature: string,
): TransferDepositEvent[] {
  if (tx.meta?.err) return [];
  if (!tx.blockTime) return [];

  const occurredAt = new Date(tx.blockTime * 1000);
  const slot = BigInt(tx.slot);
  const events: TransferDepositEvent[] = [];

  tx.transaction.message.instructions.forEach((instruction, instructionIndex) => {
    if (!isPartiallyDecodedInstruction(instruction)) return;
    if (
      instruction.programId.toBase58() !==
      PRIVATE_TRANSFER_PROGRAM_ID.toBase58()
    ) {
      return;
    }

    const decoded = decodeTelegramPrivateTransferInstruction(instruction.data);
    if (!decoded || decoded.name !== "transfer_deposit") return;

    const args = (decoded.data as { args?: ParsedTransferDepositArgs } | null)
      ?.args;
    if (!args?.amount) return;

    const accounts = instruction.accounts.map((account) => account.toString());
    if (accounts.length < ACCOUNTS_MIN_LENGTH) return;

    const senderAddress = accounts[0];
    const sourceDepositAddress =
      accounts[accounts.length - SOURCE_DEPOSIT_OFFSET_FROM_END];
    const destinationDepositAddress =
      accounts[accounts.length - DESTINATION_DEPOSIT_OFFSET_FROM_END];
    const tokenMint = accounts[accounts.length - TOKEN_MINT_OFFSET_FROM_END];

    if (
      !senderAddress ||
      !sourceDepositAddress ||
      !destinationDepositAddress ||
      !tokenMint
    ) {
      return;
    }

    events.push({
      amountRaw: BigInt(args.amount.toString()),
      destinationDepositAddress,
      instructionIndex,
      occurredAt,
      senderAddress,
      signature,
      slot,
      sourceDepositAddress,
      tokenMint,
    });
  });

  return events;
}
