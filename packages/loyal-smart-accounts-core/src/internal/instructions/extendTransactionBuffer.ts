import { PublicKey } from "@solana/web3.js";
import {
  createExtendTransactionBufferInstruction,
  PROGRAM_ID,
} from "../generated";
import { getTransactionBufferPda } from "../pda";

export function extendTransactionBuffer({
  consensusPda,
  creator,
  bufferIndex,
  buffer,
  transactionBuffer,
  programId = PROGRAM_ID,
}: {
  consensusPda: PublicKey;
  creator: PublicKey;
  bufferIndex: number;
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

  return createExtendTransactionBufferInstruction(
    {
      consensusAccount: consensusPda,
      transactionBuffer: transactionBuffer ?? derivedTransactionBuffer,
      creator,
    },
    {
      args: {
        buffer,
      },
    },
    programId
  );
}
