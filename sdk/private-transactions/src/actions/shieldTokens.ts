import { NATIVE_MINT } from "@solana/spl-token";
import {
  Transaction,
  type PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import type { InstructionCheck, RpcOptions } from "../types";
import {
  DELEGATION_PROGRAM_ID,
  getErValidatorForRpcEndpoint,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "../constants";
import { findDepositPda, findPermissionPda } from "../pda";
import {
  getMultipleAccountsInfoWithRetry,
  processEnsureChecks,
} from "../checks/enshureChecks";
import { closeWsolAta, wrapSolToWsolIx } from "../wsol";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import type { Program } from "@coral-xyz/anchor";
import { waitForAccountOwnerChange } from "../utils";
import { sendAndConfirmWithDiagnostics } from "../transaction-debug";
import { modifyBalanceIx } from "../instructions/modifyBalance";
import { initializeDepositIx } from "../instructions/initializeDeposit";
import { createPermissionIx } from "../instructions/createPermission";
import { delegateDepositIx } from "../instructions/delegateDeposit";
import { undelegateDeposit } from "./undelegateDeposit";

export async function shieldTokens(params: {
  user: PublicKey;
  payer: PublicKey;
  tokenMint: PublicKey;
  amount: bigint;
  baseProgram: Program<TelegramPrivateTransfer>;
  perProgram: Program<TelegramPrivateTransfer>;
  rpcOptions?: RpcOptions;
}): Promise<string> {
  const {
    user,
    payer,
    tokenMint,
    amount,
    baseProgram,
    perProgram,
    rpcOptions,
  } = params;

  const baseConnection = baseProgram.provider.connection;
  const perConnection = perProgram.provider.connection;

  const perRpcEndpoint = perProgram.provider.connection.rpcEndpoint;

  const isNativeSol = tokenMint.equals(NATIVE_MINT);
  const validator = getErValidatorForRpcEndpoint(perRpcEndpoint);
  const [depositPda] = findDepositPda(user, tokenMint);
  const [permissionPda] = findPermissionPda(depositPda);

  let [depositAccountInfo, permissionAccountInfo] =
    await getMultipleAccountsInfoWithRetry(
      baseConnection,
      [depositPda, permissionPda],
      "base-getMultipleAccountsInfo"
    );

  if (depositAccountInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
    await undelegateDeposit(baseProgram, perProgram, {
      user,
      payer,
      tokenMint,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
      rpcOptions,
    });
  }

  const instructions: TransactionInstruction[] = [];
  const checks: InstructionCheck[] = [];

  if (isNativeSol) {
    instructions.push(
      ...wrapSolToWsolIx({
        user,
        payer,
        lamports: amount,
      })
    );
  }

  if (!depositAccountInfo) {
    const initializeDepositIxs = await initializeDepositIx(baseProgram, {
      tokenMint,
      user,
      payer,
    });
    instructions.push(initializeDepositIxs.ix);
    checks.push(...initializeDepositIxs.ensure);
  }

  const modifyBalanceIxs = await modifyBalanceIx(baseProgram, {
    tokenMint,
    user,
    payer,
    amount,
    increase: true,
    passNotExist: true,
  });
  instructions.push(modifyBalanceIxs.ix);
  checks.push(...modifyBalanceIxs.ensure);

  if (!permissionAccountInfo) {
    const createPermissionIxs = await createPermissionIx(baseProgram, {
      tokenMint,
      user,
      payer,
      passNotExist: true,
    });
    instructions.push(createPermissionIxs.ix);
    checks.push(...createPermissionIxs.ensure);
  }

  const delegateDepositIxs = await delegateDepositIx(baseProgram, {
    tokenMint,
    user,
    payer,
    validator,
    passNotExist: true,
  });
  instructions.push(delegateDepositIxs.ix);
  checks.push(...delegateDepositIxs.ensure);

  // TODO: delegatePermissionIx

  if (isNativeSol) {
    instructions.push(
      closeWsolAta({
        user,
        destination: user,
      })
    );
  }

  await processEnsureChecks(baseConnection, perConnection, checks);

  const delegationWatcher = waitForAccountOwnerChange(
    baseConnection,
    depositPda,
    DELEGATION_PROGRAM_ID
  );

  const tx = new Transaction().add(...instructions);
  let signature;
  try {
    signature = await sendAndConfirmWithDiagnostics({
      label: "shieldTokens",
      provider: baseProgram.provider,
      tx,
      rpcOptions,
      extraContext: {
        user,
        payer,
        tokenMint,
        amount,
        isNativeSol,
        validator,
        depositPda,
        permissionPda,
        depositAccountInfo,
        permissionAccountInfo,
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
