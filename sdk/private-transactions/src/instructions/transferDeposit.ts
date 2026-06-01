import { BN, type Program } from "@coral-xyz/anchor";
import { SystemProgram, type PublicKey } from "@solana/web3.js";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import { findDepositPda } from "../pda";
import type {
  CheckedTransactionInstruction,
  TransferDepositParams,
} from "../types";

export async function transferDepositIx(
  program: Program<TelegramPrivateTransfer>,
  params: TransferDepositParams
): Promise<CheckedTransactionInstruction> {
  const { user, tokenMint, destinationUser, amount, payer, sessionToken } =
    params;

  const [sourceDepositPda] = findDepositPda(user, tokenMint);
  const [destinationDepositPda] = findDepositPda(destinationUser, tokenMint);

  const accounts: Record<string, PublicKey | null> = {
    user,
    payer,
    sourceDeposit: sourceDepositPda,
    destinationDeposit: destinationDepositPda,
    tokenMint,
    systemProgram: SystemProgram.programId,
    sessionToken: sessionToken ?? null,
  };

  const ix = await program.methods
    .transferDeposit(new BN(amount.toString()))
    .accountsPartial(accounts)
    .instruction();

  return {
    ix,
    ensure: [
      {
        address: sourceDepositPda,
        delegated: true,
        passNotExist: false,
        label: "transferDeposit-sourceDepositPda",
      },
      {
        address: destinationDepositPda,
        delegated: true,
        passNotExist: false,
        label: "transferDeposit-destinationDepositPda",
      },
    ],
  };
}
