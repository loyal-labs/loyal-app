import { BN, type Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";
import { getKaminoModifyBalanceAccountsForTokenMint } from "../constants";
import { findDepositPda, findVaultPda } from "../pda";
import type {
  CheckedTransactionInstruction,
  ModifyBalanceParams,
} from "../types";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";

export async function modifyBalanceIx(
  program: Program<TelegramPrivateTransfer>,
  params: ModifyBalanceParams
): Promise<CheckedTransactionInstruction> {
  const { user, tokenMint, amount, increase, payer, passNotExist } = params;

  const [depositPda] = findDepositPda(user, tokenMint);
  const [vaultPda] = findVaultPda(tokenMint);
  const userTokenAccount = getAssociatedTokenAddressSync(tokenMint, user);
  const vaultTokenAccount = getAssociatedTokenAddressSync(
    tokenMint,
    vaultPda,
    true
  );

  const kaminoAccounts = getKaminoModifyBalanceAccountsForTokenMint(tokenMint);
  const vaultCollateralTokenAccount = kaminoAccounts
    ? getAssociatedTokenAddressSync(
        kaminoAccounts.reserveCollateralMint,
        vaultPda,
        true
      )
    : null;

  const accounts = {
    payer,
    user,
    vault: vaultPda,
    deposit: depositPda,
    userTokenAccount,
    vaultTokenAccount,
    tokenMint,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };

  const remainingAccounts =
    kaminoAccounts && vaultCollateralTokenAccount
      ? [
          {
            pubkey: kaminoAccounts.lendingMarket,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: kaminoAccounts.lendingMarketAuthority,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: kaminoAccounts.reserve,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: kaminoAccounts.reserveLiquiditySupply,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: kaminoAccounts.reserveCollateralMint,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: vaultCollateralTokenAccount,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: kaminoAccounts.instructionSysvarAccount,
            isSigner: false,
            isWritable: false,
          },
          {
            pubkey: kaminoAccounts.klendProgram,
            isSigner: false,
            isWritable: false,
          },
        ]
      : [];

  const ix = await program.methods
    .modifyBalance({ amount: new BN(amount.toString()), increase })
    .accountsPartial(accounts)
    .remainingAccounts(remainingAccounts)
    .instruction();

  return {
    ix,
    ensure: [
      {
        address: depositPda,
        delegated: false,
        passNotExist: passNotExist === undefined ? false : passNotExist,
        label: "modifyBalance-depositPda",
      },
    ],
  };
}
