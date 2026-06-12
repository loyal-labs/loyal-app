import { createCommitAndUndelegatePermissionInstruction } from "@magicblock-labs/ephemeral-rollups-sdk";
import type {
  CheckedTransactionInstruction,
  UndelegatePermissionParams,
} from "../types";
import { findDepositPda, findPermissionPda } from "../pda";

export function undelegatePermissionIx(
  params: UndelegatePermissionParams
): CheckedTransactionInstruction {
  const { user, tokenMint } = params;

  const [depositPda] = findDepositPda(user, tokenMint);
  const [permissionPda] = findPermissionPda(depositPda);

  const ix = createCommitAndUndelegatePermissionInstruction({
    authority: [user, true], // must have AUTHORITY_FLAG
    permissionedAccount: [depositPda, false],
  });

  return {
    ix,
    ensure: [
      {
        address: permissionPda,
        delegated: true,
        passNotExist: false,
        label: "undelegatePermission-permissionPda",
      },
    ],
  };
}
