import { BN, type Program } from "@coral-xyz/anchor";
import { SystemProgram, type PublicKey } from "@solana/web3.js";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import { findDepositPda, findUsernameDepositPda } from "../pda";
import type {
  CheckedTransactionInstruction,
  TransferToUsernameDepositParams,
} from "../types";
import { validateUsername } from "../utils";

export async function transferToUsernameDepositIx(
  program: Program<TelegramPrivateTransfer>,
  params: TransferToUsernameDepositParams
): Promise<CheckedTransactionInstruction> {
  const { username, tokenMint, amount, user, payer, sessionToken } = params;

  validateUsername(username);

  const [sourceDepositPda] = findDepositPda(user, tokenMint);
  const [destinationDepositPda] = await findUsernameDepositPda(
    username,
    tokenMint
  );

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
    .transferToUsernameDeposit(new BN(amount.toString()))
    .accountsPartial(accounts)
    .instruction();

  return {
    ix,
    ensure: [
      {
        address: sourceDepositPda,
        delegated: true,
        passNotExist: false,
        label: "transferToUsernameDeposit-sourceDepositPda",
      },
      {
        address: destinationDepositPda,
        delegated: true,
        passNotExist: false,
        label: "transferToUsernameDeposit-destinationDepositPda",
      },
    ],
  };
}
