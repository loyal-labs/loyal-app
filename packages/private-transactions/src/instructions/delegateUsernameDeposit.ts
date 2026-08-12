import { type Program } from "@coral-xyz/anchor";
import { SystemProgram, type PublicKey } from "@solana/web3.js";
import { DELEGATION_PROGRAM_ID, PROGRAM_ID } from "../constants";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import {
  findBufferPda,
  findDelegationMetadataPda,
  findDelegationRecordPda,
  findUsernameDepositPda,
} from "../pda";
import type {
  CheckedTransactionInstruction,
  DelegateUsernameDepositParams,
} from "../types";
import { sha256hash, validateUsername } from "../utils";

export async function delegateUsernameDepositIx(
  program: Program<TelegramPrivateTransfer>,
  params: DelegateUsernameDepositParams
): Promise<CheckedTransactionInstruction> {
  const { username, tokenMint, payer, validator, passNotExist } = params;

  validateUsername(username);

  const [depositPda] = await findUsernameDepositPda(username, tokenMint);
  const [bufferPda] = findBufferPda(depositPda);
  const [delegationRecordPda] = findDelegationRecordPda(depositPda);
  const [delegationMetadataPda] = findDelegationMetadataPda(depositPda);
  const usernameHash = await sha256hash(username);

  const accounts: Record<string, PublicKey | null> = {
    payer,
    bufferDeposit: bufferPda,
    delegationRecordDeposit: delegationRecordPda,
    delegationMetadataDeposit: delegationMetadataPda,
    deposit: depositPda,
    validator,
    ownerProgram: PROGRAM_ID,
    delegationProgram: DELEGATION_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };

  const ix = await program.methods
    .delegateUsernameDeposit(usernameHash, tokenMint)
    .accountsPartial(accounts)
    .instruction();

  return {
    ix,
    ensure: [
      {
        address: depositPda,
        delegated: false,
        passNotExist: passNotExist === undefined ? false : passNotExist,
        label: "delegateUsernameDeposit-depositPda",
      },
    ],
  };
}
