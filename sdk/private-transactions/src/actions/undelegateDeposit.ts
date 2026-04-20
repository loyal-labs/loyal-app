import type { Program } from "@coral-xyz/anchor";
import { undelegateDepositIx } from "../instructions/undelegateDeposit";
import type { UndelegateDepositParams } from "../types";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import { processEnsureChecks } from "../checks/enshureChecks";
import { findDepositPda } from "../pda";
import { waitForAccountOwnerChange } from "../utils";
import { PROGRAM_ID } from "../constants";
import { Transaction } from "@solana/web3.js";
import { sendAndConfirmWithDiagnostics } from "../transaction-debug";

/**
 * Undelegate a deposit account from the ephemeral rollup.
 * Waits for both base and ephemeral connections to confirm the deposit
 * is owned by PROGRAM_ID before returning.
 */
export async function undelegateDeposit(
  baseProgram: Program<TelegramPrivateTransfer>,
  perProgram: Program<TelegramPrivateTransfer>,
  params: UndelegateDepositParams
): Promise<string> {
  const { user, tokenMint } = params;
  const { ix, ensure } = await undelegateDepositIx(perProgram, params);

  const baseConnection = baseProgram.provider.connection;
  const perConnection = perProgram.provider.connection;

  await processEnsureChecks(baseConnection, perConnection, ensure);

  const [depositPda] = findDepositPda(user, tokenMint);

  const delegationWatcher = waitForAccountOwnerChange(
    baseConnection,
    depositPda,
    PROGRAM_ID
  );

  const tx = new Transaction().add(ix);
  let signature;
  try {
    signature = await sendAndConfirmWithDiagnostics({
      label: "undelegateDeposit",
      provider: perProgram.provider,
      tx,
      rpcOptions: params.rpcOptions,
      extraContext: {
        user,
        tokenMint,
        depositPda,
      },
    });
    await delegationWatcher.wait();
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  } catch (e) {
    await delegationWatcher.cancel();
    throw e;
  }

  return signature;
}
