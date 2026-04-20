import type { Program } from "@coral-xyz/anchor";
import { PERMISSION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import type {
  CheckedTransactionInstruction,
  CreatePermissionParams,
} from "../types";
import { findDepositPda, findPermissionPda } from "../pda";

export async function createPermissionIx(
  program: Program<TelegramPrivateTransfer>,
  params: CreatePermissionParams
): Promise<CheckedTransactionInstruction> {
  const { user, tokenMint, payer, passNotExist } = params;

  const [depositPda] = findDepositPda(user, tokenMint);
  const [permissionPda] = findPermissionPda(depositPda);

  const ix = await program.methods
    .createPermission()
    .accountsPartial({
      payer,
      user,
      deposit: depositPda,
      permission: permissionPda,
      permissionProgram: PERMISSION_PROGRAM_ID,
    })
    .instruction();

  return {
    ix,
    ensure: [
      {
        address: depositPda,
        delegated: false,
        passNotExist: passNotExist === undefined ? true : passNotExist,
        label: "createPermission-depositPda",
      },
      {
        address: permissionPda,
        delegated: false,
        passNotExist: true,
        label: "createPermission-permissionPda",
      },
    ],
  };
}
