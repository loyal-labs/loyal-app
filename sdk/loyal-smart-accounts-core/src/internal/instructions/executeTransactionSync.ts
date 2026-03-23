import { PublicKey } from "@solana/web3.js";
import {
  createExecuteTransactionSyncInstruction,
  PROGRAM_ID,
} from "../generated";

export function executeTransactionSync({
  feePayer,
  settingsPda,
  accountIndex,
  numSigners,
  instructions,
  instruction_accounts,
  programId = PROGRAM_ID,
}: {
  feePayer: PublicKey;
  settingsPda: PublicKey;
  accountIndex: number;
  numSigners: number;
  instructions: Uint8Array;
  instruction_accounts: {
    pubkey: PublicKey;
    isWritable: boolean;
    isSigner: boolean;
  }[];
  programId?: PublicKey;
}) {
  const ix = createExecuteTransactionSyncInstruction(
    {
      consensusAccount: settingsPda,
      program: programId,
      anchorRemainingAccounts: instruction_accounts,
    },
    {
      args: {
        accountIndex,
        numSigners,
        instructions,
      },
    },
    programId
  );
  return ix;
}
