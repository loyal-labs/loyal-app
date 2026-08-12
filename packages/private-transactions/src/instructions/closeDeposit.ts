import type { Program } from "@coral-xyz/anchor";
import type {
  CheckedTransactionInstruction,
  CloseDepositParams,
} from "../types";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import { findDepositPda } from "../pda";

export async function closeDepositIx(
  program: Program<TelegramPrivateTransfer>,
  params: CloseDepositParams
): Promise<CheckedTransactionInstruction> {
  const { user, tokenMint } = params;

  const [depositPda] = findDepositPda(user, tokenMint);

  const ix = await program.methods
    .closeDeposit()
    .accountsPartial({
      user,
      deposit: depositPda,
      tokenMint,
    })
    .instruction();

  return {
    ix,
    ensure: [
      {
        address: depositPda,
        delegated: false,
        passNotExist: false,
        label: "closeDeposit-depositPda",
      },
    ],
  };
}
