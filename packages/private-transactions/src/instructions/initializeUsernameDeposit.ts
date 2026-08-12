import type { Program } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";
import { findUsernameDepositPda } from "../pda";
import type {
  CheckedTransactionInstruction,
  InitializeUsernameDepositParams,
} from "../types";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import { sha256hash, validateUsername } from "../utils";

export async function initializeUsernameDepositIx(
  program: Program<TelegramPrivateTransfer>,
  params: InitializeUsernameDepositParams
): Promise<CheckedTransactionInstruction> {
  const { username, tokenMint, payer } = params;

  validateUsername(username);

  const [usernameDepositPda] = await findUsernameDepositPda(
    username,
    tokenMint
  );

  const usernameHash = await sha256hash(username);

  const ix = await program.methods
    .initializeUsernameDeposit(usernameHash)
    .accountsPartial({
      payer,
      tokenMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return {
    ix,
    ensure: [
      {
        address: usernameDepositPda,
        delegated: false,
        passNotExist: true,
        label: "initializeUsernameDeposit-usernameDepositPda",
      },
    ],
  };
}
