import type { Program } from "@coral-xyz/anchor";
import type {
  CheckedTransactionInstruction,
  CloseUsernameDepositParams,
} from "../types";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import { findUsernameDepositPda } from "../pda";
import { validateUsername } from "../utils";

export async function closeUsernameDepositIx(
  program: Program<TelegramPrivateTransfer>,
  params: CloseUsernameDepositParams
): Promise<CheckedTransactionInstruction> {
  const { username, tokenMint, authority, session } = params;

  validateUsername(username);

  const [depositPda] = await findUsernameDepositPda(username, tokenMint);

  const ix = await program.methods
    .closeUsernameDeposit()
    .accountsPartial({
      authority,
      deposit: depositPda,
      tokenMint,
      session,
    })
    .instruction();

  return {
    ix,
    ensure: [
      {
        address: depositPda,
        delegated: false,
        passNotExist: false,
        label: "closeUsernameDeposit-depositPda",
      },
    ],
  };
}
