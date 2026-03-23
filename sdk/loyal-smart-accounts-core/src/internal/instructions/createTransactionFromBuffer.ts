import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createCreateTransactionFromBufferInstruction,
  PROGRAM_ID,
} from "../generated";
import { getTransactionBufferPda, getTransactionPda } from "../pda";

const EMPTY_TRANSACTION_MESSAGE = new Uint8Array(6).fill(0);

export function createTransactionFromBuffer({
  consensusPda,
  creator,
  rentPayer,
  transactionIndex,
  bufferIndex,
  accountIndex,
  ephemeralSigners,
  transactionBuffer,
  memo,
  programId = PROGRAM_ID,
}: {
  consensusPda: PublicKey;
  creator: PublicKey;
  rentPayer?: PublicKey;
  transactionIndex: bigint;
  bufferIndex: number;
  accountIndex: number;
  ephemeralSigners: number;
  transactionBuffer?: PublicKey;
  memo?: string;
  programId?: PublicKey;
}) {
  const [transaction] = getTransactionPda({
    settingsPda: consensusPda,
    transactionIndex,
    programId,
  });
  const [derivedTransactionBuffer] = getTransactionBufferPda({
    consensusPda,
    creator,
    bufferIndex,
    programId,
  });

  return createCreateTransactionFromBufferInstruction(
    {
      transactionCreateItemConsensusAccount: consensusPda,
      transactionCreateItemTransaction: transaction,
      transactionCreateItemCreator: creator,
      transactionCreateItemRentPayer: rentPayer ?? creator,
      transactionCreateItemSystemProgram: SystemProgram.programId,
      transactionCreateItemProgram: programId,
      transactionBuffer: transactionBuffer ?? derivedTransactionBuffer,
      creator,
    },
    {
      args: {
        __kind: "TransactionPayload",
        fields: [
          {
            accountIndex,
            transactionMessage: EMPTY_TRANSACTION_MESSAGE,
            ephemeralSigners,
            memo: memo ?? null,
          },
        ],
      },
    },
    programId
  );
}
