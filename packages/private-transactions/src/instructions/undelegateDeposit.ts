import type { Program } from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import type {
  CheckedTransactionInstruction,
  UndelegateDepositParams,
} from "../types";
import { findDepositPda } from "../pda";

export async function undelegateDepositIx(
  perProgram: Program<TelegramPrivateTransfer>,
  params: UndelegateDepositParams
): Promise<CheckedTransactionInstruction> {
  const { user, tokenMint, payer, magicProgram, magicContext } = params;

  const [depositPda] = findDepositPda(user, tokenMint);

  const accounts: Record<string, PublicKey | null> = {
    user,
    payer,
    deposit: depositPda,
    magicProgram,
    magicContext,
  };

  const ix = await perProgram.methods
    .undelegate()
    .accountsPartial(accounts)
    .instruction();

  return {
    ix,
    ensure: [
      {
        address: depositPda,
        delegated: true,
        passNotExist: false,
        label: "undelegateDeposit-depositPda",
      },
    ],
  };
}
