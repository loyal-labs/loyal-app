import type { Program } from "@coral-xyz/anchor";
import {
  Transaction,
  type PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import { PROGRAM_ID } from "../constants";
import { undelegateDepositIx } from "../instructions/undelegateDeposit";
import type {
  InstructionCheck,
  RpcOptions,
  UndelegateDepositParams,
} from "../types";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import { processEnsureChecks } from "../checks/enshureChecks";
import { findDepositPda } from "../pda";
import { waitForAccountOwnerChange } from "../utils";
import { sendAndConfirmWithDiagnostics } from "../transaction-debug";

export type PlannedUndelegateDepositTransaction = {
  label: string;
  instructions: { ix: TransactionInstruction }[];
  checks: InstructionCheck[];
};

export async function sendPlannedUndelegateDepositTransaction(params: {
  baseProgram: Program<TelegramPrivateTransfer>;
  perProgram: Program<TelegramPrivateTransfer>;
  transaction: PlannedUndelegateDepositTransaction;
  user: PublicKey;
  tokenMint: PublicKey;
  rpcOptions?: RpcOptions;
}): Promise<string> {
  const { baseProgram, perProgram, transaction, user, tokenMint, rpcOptions } =
    params;

  await processEnsureChecks(
    baseProgram.provider.connection,
    perProgram.provider.connection,
    transaction.checks
  );

  const [depositPda] = findDepositPda(user, tokenMint);
  const delegationWatcher = waitForAccountOwnerChange(
    baseProgram.provider.connection,
    depositPda,
    PROGRAM_ID
  );

  const tx = new Transaction().add(
    ...transaction.instructions.map(({ ix }) => ix)
  );
  let signature: string;
  try {
    signature = await sendAndConfirmWithDiagnostics({
      label: transaction.label,
      provider: perProgram.provider,
      tx,
      rpcOptions,
      extraContext: {
        user,
        tokenMint,
        depositPda,
      },
    });
  } catch (e) {
    await delegationWatcher.cancel();
    throw e;
  }

  // Undelegate already landed on-chain. Ownership-change observation is
  // best-effort from here: a wait timeout must not surface as an
  // unshield failure to the caller (ASK-1134).
  try {
    await delegationWatcher.wait();
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  } catch (err) {
    console.warn(
      `[${transaction.label}] delegation watcher did not observe owner change (signature=${signature}); continuing`,
      err
    );
  }

  return signature;
}

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

  return sendPlannedUndelegateDepositTransaction({
    baseProgram,
    perProgram,
    transaction: {
      label: "undelegateDeposit",
      instructions: [{ ix }],
      checks: ensure,
    },
    user,
    tokenMint,
    rpcOptions: params.rpcOptions,
  });
}
