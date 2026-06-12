import {
  createClosePermissionInstruction,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { findDepositPda, findPermissionPda } from "../pda";
import type {
  CheckedTransactionInstruction,
  ClosePermissionParams,
} from "../types";

export function closePermissionIx(
  params: ClosePermissionParams
): CheckedTransactionInstruction {
  const { user, tokenMint } = params;

  const [depositPda] = findDepositPda(user, tokenMint);
  const [permissionPda] = findPermissionPda(depositPda);

  const ix = createClosePermissionInstruction({
    payer: user, // receives reclaimed permission-account lamports
    authority: [user, true], // must have AUTHORITY_FLAG
    permissionedAccount: [depositPda, false],
  });

  return {
    ix,
    ensure: [
      {
        address: permissionPda,
        delegated: false,
        passNotExist: false,
        label: "closePermission-permissionPda",
      },
    ],
  };
}
