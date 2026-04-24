import { NATIVE_MINT } from "@solana/spl-token";
import { Transaction, type PublicKey } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import {
  DELEGATION_PROGRAM_ID,
  getErValidatorForRpcEndpoint,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PROGRAM_ID,
} from "../constants";
import { processEnsureChecks } from "../checks/enshureChecks";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import { delegateDepositIx } from "../instructions/delegateDeposit";
import { modifyBalanceIx } from "../instructions/modifyBalance";
import { findDepositPda } from "../pda";
import {
  estimateDepositDelegationRentLamports,
  estimateModifyBalanceRentLamports,
} from "../rent-estimate";
import type { InstructionCheck, RpcOptions } from "../types";
import { sendAndConfirmWithDiagnostics } from "../transaction-debug";
import { waitForAccountOwnerChange } from "../utils";
import { closeWsolAta, wrapSolToWsolIx } from "../wsol";
import { undelegateDepositIx } from "../instructions/undelegateDeposit";
import {
  labelTransactionInstructions,
  type LabeledTransactionInstruction,
  type LabeledTransactionPlan,
} from "./shieldTokens";
import { sendPlannedUndelegateDepositTransaction } from "./undelegateDeposit";

export type UnshieldTokensInstructionPlan = {
  instructions: LabeledTransactionInstruction[];
  checks: InstructionCheck[];
  needsUndelegate: boolean;
  shouldRedelegate: boolean;
  context: {
    isNativeSol: boolean;
    validator: PublicKey;
    depositPda: PublicKey;
    currentDepositAmount: bigint | null;
  };
};

export type UnshieldTokensTransactionPlan = {
  preUndelegateTransaction: LabeledTransactionPlan | null;
  baseTransaction: LabeledTransactionPlan;
  shouldRedelegate: boolean;
  context: UnshieldTokensInstructionPlan["context"];
};

export async function buildUnshieldTokensInstructionPlan(params: {
  user: PublicKey;
  payer: PublicKey;
  tokenMint: PublicKey;
  amount: bigint;
  baseProgram: Program<TelegramPrivateTransfer>;
  perProgram: Program<TelegramPrivateTransfer>;
  validator?: PublicKey;
}): Promise<UnshieldTokensInstructionPlan> {
  const { user, payer, tokenMint, amount, baseProgram, perProgram } = params;

  const baseConnection = baseProgram.provider.connection;
  const perRpcEndpoint = perProgram.provider.connection.rpcEndpoint;

  const isNativeSol = tokenMint.equals(NATIVE_MINT);
  const validator =
    params.validator ?? getErValidatorForRpcEndpoint(perRpcEndpoint);
  const [depositPda] = findDepositPda(user, tokenMint);
  const depositAccountInfoPromise = baseConnection.getAccountInfo(depositPda);
  const modifyBalanceRentLamportsPromise = estimateModifyBalanceRentLamports({
    connection: baseConnection,
    user,
    tokenMint,
    isNativeSol,
  });
  const depositAccountInfo = await depositAccountInfoPromise;
  const needsUndelegate =
    depositAccountInfo?.owner.equals(DELEGATION_PROGRAM_ID) ?? false;
  const currentDepositAccount = needsUndelegate
    ? await perProgram.account.deposit.fetchNullable(depositPda)
    : depositAccountInfo?.owner.equals(PROGRAM_ID)
    ? await baseProgram.account.deposit.fetchNullable(depositPda)
    : null;
  const currentDepositAmount = currentDepositAccount
    ? BigInt(currentDepositAccount.amount.toString())
    : null;
  const shouldRedelegate =
    currentDepositAmount !== null && currentDepositAmount - amount > 0n;
  const [modifyBalanceRentLamports, delegationRentLamports] = await Promise.all(
    [
      modifyBalanceRentLamportsPromise,
      shouldRedelegate
        ? estimateDepositDelegationRentLamports({
            connection: baseConnection,
            user,
            tokenMint,
            depositPda,
            forceCreate: needsUndelegate,
          })
        : Promise.resolve(0),
    ]
  );

  const instructions: LabeledTransactionInstruction[] = [];
  const checks: InstructionCheck[] = [];

  if (isNativeSol) {
    instructions.push(
      ...labelTransactionInstructions(
        "ensureWsolAta",
        wrapSolToWsolIx({
          user,
          payer,
          lamports: 0n,
        })
      )
    );
  }

  const modifyBalanceIxs = await modifyBalanceIx(baseProgram, {
    tokenMint,
    user,
    payer,
    amount,
    increase: false,
  });
  instructions.push({
    label: "modifyBalanceDecrease",
    ix: modifyBalanceIxs.ix,
    rentLamports: modifyBalanceRentLamports,
  });
  checks.push(...modifyBalanceIxs.ensure);

  if (isNativeSol) {
    instructions.push({
      label: "closeWsolAta",
      ix: closeWsolAta({
        user,
        destination: user,
      }),
    });
  }

  if (shouldRedelegate) {
    const delegateDepositIxs = await delegateDepositIx(baseProgram, {
      tokenMint,
      user,
      payer,
      validator,
    });
    instructions.push({
      label: "redelegateDeposit",
      ix: delegateDepositIxs.ix,
      rentLamports: delegationRentLamports,
    });
    checks.push(...delegateDepositIxs.ensure);
  }

  return {
    instructions,
    checks,
    needsUndelegate,
    shouldRedelegate,
    context: {
      isNativeSol,
      validator,
      depositPda,
      currentDepositAmount,
    },
  };
}

export async function buildUnshieldTokensTransactionPlan(params: {
  user: PublicKey;
  payer: PublicKey;
  tokenMint: PublicKey;
  amount: bigint;
  baseProgram: Program<TelegramPrivateTransfer>;
  perProgram: Program<TelegramPrivateTransfer>;
  validator?: PublicKey;
  sessionToken?: PublicKey | null;
  magicProgram?: PublicKey;
  magicContext?: PublicKey;
}): Promise<UnshieldTokensTransactionPlan> {
  const instructionPlan = await buildUnshieldTokensInstructionPlan(params);
  let preUndelegateTransaction: LabeledTransactionPlan | null = null;

  if (instructionPlan.needsUndelegate) {
    const undelegateIxs = await undelegateDepositIx(params.perProgram, {
      user: params.user,
      payer: params.payer,
      tokenMint: params.tokenMint,
      sessionToken: params.sessionToken,
      magicProgram: params.magicProgram ?? MAGIC_PROGRAM_ID,
      magicContext: params.magicContext ?? MAGIC_CONTEXT_ID,
    });
    preUndelegateTransaction = {
      label: "unshield:undelegate",
      cluster: "ephemeral",
      instructions: [{ label: "undelegateDeposit", ix: undelegateIxs.ix }],
      checks: undelegateIxs.ensure,
    };
  }

  return {
    preUndelegateTransaction,
    baseTransaction: {
      label: "unshield",
      cluster: "base",
      instructions: instructionPlan.instructions,
      checks: instructionPlan.checks,
    },
    shouldRedelegate: instructionPlan.shouldRedelegate,
    context: instructionPlan.context,
  };
}

/**
 * Unshield tokens: move from a Loyal private deposit back to a regular wallet.
 * If the deposit is delegated, this first commits it back to base, then sends
 * one base transaction for withdraw/native-SOL close/redelegate.
 */
export async function unshieldTokens(params: {
  user: PublicKey;
  payer: PublicKey;
  tokenMint: PublicKey;
  amount: bigint;
  baseProgram: Program<TelegramPrivateTransfer>;
  perProgram: Program<TelegramPrivateTransfer>;
  validator?: PublicKey;
  sessionToken?: PublicKey | null;
  magicProgram?: PublicKey;
  magicContext?: PublicKey;
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
  const plan = await buildUnshieldTokensTransactionPlan({
    user,
    payer,
    tokenMint,
    amount,
    baseProgram,
    perProgram,
    validator: params.validator,
    sessionToken: params.sessionToken,
    magicProgram: params.magicProgram,
    magicContext: params.magicContext,
  });
  const {
    shouldRedelegate,
    context: { validator, depositPda, isNativeSol, currentDepositAmount },
  } = plan;

  if (plan.preUndelegateTransaction) {
    await sendPlannedUndelegateDepositTransaction({
      baseProgram,
      perProgram,
      transaction: plan.preUndelegateTransaction,
      user,
      tokenMint,
      rpcOptions,
    });
  }

  await processEnsureChecks(
    baseConnection,
    perConnection,
    plan.baseTransaction.checks
  );

  const delegationWatcher = shouldRedelegate
    ? waitForAccountOwnerChange(
        baseConnection,
        depositPda,
        DELEGATION_PROGRAM_ID
      )
    : null;

  const tx = new Transaction().add(
    ...plan.baseTransaction.instructions.map(({ ix }) => ix)
  );
  let signature;
  try {
    signature = await sendAndConfirmWithDiagnostics({
      label: "unshieldTokens",
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
        currentDepositAmount,
        shouldRedelegate,
      },
    });
    if (delegationWatcher) {
      await delegationWatcher.wait();
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  } catch (e) {
    await delegationWatcher?.cancel();
    throw e;
  }

  return signature;
}
