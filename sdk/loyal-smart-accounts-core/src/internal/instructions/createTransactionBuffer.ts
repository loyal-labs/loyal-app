import { PublicKey } from "@solana/web3.js";
import {
  createCreateTransactionBufferInstruction,
  PROGRAM_ID,
} from "../generated";
import { getTransactionBufferPda } from "../pda";

export function createTransactionBuffer({
  consensusPda,
  creator,
  rentPayer,
  bufferIndex,
  accountIndex,
  finalBufferHash,
  finalBufferSize,
  buffer,
  transactionBuffer,
  programId = PROGRAM_ID,
}: {
  consensusPda: PublicKey;
  creator: PublicKey;
  rentPayer?: PublicKey;
  bufferIndex: number;
  accountIndex: number;
  finalBufferHash: number[] | Uint8Array;
  finalBufferSize: number;
  buffer: Uint8Array;
  transactionBuffer?: PublicKey;
  programId?: PublicKey;
}) {
  const [derivedTransactionBuffer] = getTransactionBufferPda({
    consensusPda,
    creator,
    bufferIndex,
    programId,
  });

  return createCreateTransactionBufferInstruction(
    {
      consensusAccount: consensusPda,
      transactionBuffer: transactionBuffer ?? derivedTransactionBuffer,
      creator,
      rentPayer: rentPayer ?? creator,
    },
    {
      args: {
        bufferIndex,
        accountIndex,
        finalBufferHash: Array.from(finalBufferHash),
        finalBufferSize,
        buffer,
      },
    },
    programId
  );
}
