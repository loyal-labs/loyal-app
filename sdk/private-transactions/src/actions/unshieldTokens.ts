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
import { closeDepositIx } from "../instructions/closeDeposit";
import { closePermissionIx } from "../instructions/closePermission";
import { delegateDepositIx } from "../instructions/delegateDeposit";
import { modifyBalanceIx } from "../instructions/modifyBalance";
import { undelegateDepositIx } from "../instructions/undelegateDeposit";
import { findDepositPda, findPermissionPda } from "../pda";
import {
  estimateDepositDelegationRentLamports,
  estimateDepositDelegationRentCreditLamports,
  estimateModifyBalanceRentLamports,
} from "../rent-estimate";
import type { InstructionCheck, RpcOptions } from "../types";
import { sendAndConfirmWithDiagnostics } from "../transaction-debug";
import { waitForAccountOwnerChange } from "../utils";
import { closeWsolAta, createWsolAta, wrapSolToWsolIx } from "../wsol";
import {
  labelTransactionInstructions,
  type LabeledTransactionInstruction,
  type LabeledTransactionPlan,
} from "./shieldTokens";
import { sendPlannedUndelegateDepositTransaction } from "./undelegateDeposit";
import { undelegatePermissionIx } from "../instructions/undelegatePermission";

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
  const [permissionPda] = findPermissionPda(depositPda);
  const depositAccountInfoPromise = baseConnection.getAccountInfo(depositPda);
  const permissionAccountInfoPromise =
    baseConnection.getAccountInfo(permissionPda);
  const modifyBalanceRentLamportsPromise = estimateModifyBalanceRentLamports({
    connection: baseConnection,
    user,
    tokenMint,
    isNativeSol,
  });
  const [depositAccountInfo, permissionAccountInfo] = await Promise.all([
    depositAccountInfoPromise,
    permissionAccountInfoPromise,
  ]);
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
  // If we do partial unshield then we should redelegate remaining deposit
  const shouldRedelegate =
    currentDepositAmount !== null && currentDepositAmount - amount > 0n;
  const closePermissionRentLamports = shouldRedelegate
    ? 0
    : -(permissionAccountInfo?.lamports ?? 0);
  const closeDepositRentLamports = shouldRedelegate
    ? 0
    : -(depositAccountInfo?.lamports ?? 0);
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
      ...labelTransactionInstructions("ensureWsolAta", [
        createWsolAta({ user, payer }),
      ])
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
    nativeLamports: isNativeSol ? -Number(amount) : undefined,
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
  } else {
    // Unshield of full amount - do cleanup

    if (
      permissionAccountInfo &&
      permissionAccountInfo.lamports > 0 &&
      permissionAccountInfo.data.length > 0
    ) {
      // Close permissions
      const closePermissionIxs = await closePermissionIx({ user, tokenMint });
      instructions.push({
        label: "closePermission",
        ix: closePermissionIxs.ix,
        rentLamports: closePermissionRentLamports,
      });
      checks.push(...closePermissionIxs.ensure);
    }

    const closeDepositIxs = await closeDepositIx(baseProgram, {
      user,
      tokenMint,
    });
    instructions.push({
      label: "closeDeposit",
      ix: closeDepositIxs.ix,
      rentLamports: closeDepositRentLamports,
    });
    checks.push(...closeDepositIxs.ensure);
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
    preUndelegateTransaction = {
      label: "unshield:undelegate",
      cluster: "ephemeral",
      instructions: [],
      checks: [],
    };

    // For full amount unshield undelegate permission
    // if (!instructionPlan.shouldRedelegate) {
    //   const undelegatePermissionIxs = await undelegatePermissionIx({
    //     user: params.user,
    //     tokenMint: params.tokenMint,
    //   });
    //   preUndelegateTransaction.instructions.push({
    //     label: "undelegatePermission",
    //     ix: undelegatePermissionIxs.ix,
    //   });
    //   preUndelegateTransaction.checks.push(...undelegatePermissionIxs.ensure);
    // }

    const undelegateDepositIxs = await undelegateDepositIx(params.perProgram, {
      user: params.user,
      payer: params.payer,
      tokenMint: params.tokenMint,
      sessionToken: params.sessionToken,
      magicProgram: params.magicProgram ?? MAGIC_PROGRAM_ID,
      magicContext: params.magicContext ?? MAGIC_CONTEXT_ID,
    });
    const undelegateRentLamports =
      await estimateDepositDelegationRentCreditLamports({
        connection: params.baseProgram.provider.connection,
        depositPda: instructionPlan.context.depositPda,
      });
    preUndelegateTransaction.instructions.push({
      label: "undelegateDeposit",
      ix: undelegateDepositIxs.ix,
      rentLamports: undelegateRentLamports,
    });
    preUndelegateTransaction.checks.push(...undelegateDepositIxs.ensure);
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
