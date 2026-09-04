import { PublicKey } from "@solana/web3.js";
import {
  createCloseTransactionBufferInstruction,
  PROGRAM_ID,
} from "../generated";
import { getTransactionBufferPda } from "../pda";

export function closeTransactionBuffer({
  consensusPda,
  creator,
  bufferIndex,
  transactionBuffer,
  programId = PROGRAM_ID,
}: {
  consensusPda: PublicKey;
  creator: PublicKey;
  bufferIndex: number;
  transactionBuffer?: PublicKey;
  programId?: PublicKey;
}) {
  const [derivedTransactionBuffer] = getTransactionBufferPda({
    consensusPda,
    creator,
    bufferIndex,
    programId,
  });

  return createCloseTransactionBufferInstruction(
    {
      consensusAccount: consensusPda,
      transactionBuffer: transactionBuffer ?? derivedTransactionBuffer,
      creator,
    },
    programId
  );
}
