import type { Program } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import { findDepositPda } from "../pda";
import type {
  CheckedTransactionInstruction,
  InitializeDepositParams,
} from "../types";

export async function initializeDepositIx(
  program: Program<TelegramPrivateTransfer>,
  params: InitializeDepositParams
): Promise<CheckedTransactionInstruction> {
  const { user, tokenMint, payer } = params;

  const [depositPda] = findDepositPda(user, tokenMint);

  const ix = await program.methods
    .initializeDeposit()
    .accountsPartial({
      payer,
      user,
      tokenMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return {
    ix,
    ensure: [
      {
        address: depositPda,
        delegated: false,
        passNotExist: true,
        label: "initializeDeposit-depositPda",
      },
    ],
  };
}
