import type { Program } from "@coral-xyz/anchor";
import type {
  CheckedTransactionInstruction,
  DelegateDepositParams,
} from "../types";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import {
  findBufferPda,
  findDelegationMetadataPda,
  findDelegationRecordPda,
  findDepositPda,
} from "../pda";
import { DELEGATION_PROGRAM_ID, PROGRAM_ID } from "../constants";

export async function delegateDepositIx(
  program: Program<TelegramPrivateTransfer>,
  params: DelegateDepositParams
): Promise<CheckedTransactionInstruction> {
  const { user, tokenMint, payer, validator, passNotExist } = params;

  const [depositPda] = findDepositPda(user, tokenMint);
  const [bufferPda] = findBufferPda(depositPda);
  const [delegationRecordPda] = findDelegationRecordPda(depositPda);
  const [delegationMetadataPda] = findDelegationMetadataPda(depositPda);

  const ix = await program.methods
    .delegate(user, tokenMint)
    .accountsPartial({
      payer,
      bufferDeposit: bufferPda,
      delegationRecordDeposit: delegationRecordPda,
      delegationMetadataDeposit: delegationMetadataPda,
      deposit: depositPda,
      validator,
      ownerProgram: PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM_ID,
    })
    .instruction();

  return {
    ix,
    ensure: [
      {
        address: depositPda,
        delegated: false,
        passNotExist: passNotExist === undefined ? false : passNotExist,
        label: "delegateDeposit-depositPda",
      },
    ],
  };
}
