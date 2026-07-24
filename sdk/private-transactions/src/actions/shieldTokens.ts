import { NATIVE_MINT } from "@solana/spl-token";
import {
  Transaction,
  type AccountInfo,
  type Commitment,
  type Connection,
  type PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import type {
  FeeEstimateCluster,
  InstructionCheck,
  RpcOptions,
} from "../types";
import {
  DELEGATION_PROGRAM_ID,
  getErValidatorForRpcEndpoint,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "../constants";
import { findDepositPda, findPermissionPda } from "../pda";
import {
  estimateDepositDelegationRentLamports,
  estimateDepositDelegationRentCreditLamports,
  estimateDepositRentLamports,
  estimateModifyBalanceRentLamports,
  estimatePermissionRentLamports,
} from "../rent-estimate";
import {
  getMultipleAccountsInfoWithRetry,
  processEnsureChecks,
} from "../checks/enshureChecks";
import { closeWsolAta, wrapSolToWsolIx } from "../wsol";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import type { Program } from "@coral-xyz/anchor";
import { waitForAccountOwnerChange } from "../utils";
import {
  DEFAULT_TRANSACTION_COMMITMENT,
  sendAndConfirmWithDiagnostics,
} from "../transaction-debug";
import {
  calculateKaminoDepositableLiquidityAmountRaw,
  fetchKaminoReserveSnapshot,
} from "../kamino";
import { modifyBalanceIx } from "../instructions/modifyBalance";
import { initializeDepositIx } from "../instructions/initializeDeposit";
import { createPermissionIx } from "../instructions/createPermission";
import { delegateDepositIx } from "../instructions/delegateDeposit";
import { undelegateDepositIx } from "../instructions/undelegateDeposit";
import { sendPlannedUndelegateDepositTransaction } from "./undelegateDeposit";

export type LabeledTransactionInstruction = {
  label: string;
  ix: TransactionInstruction;
  rentLamports?: number;
  nativeLamports?: number;
};

export type LabeledTransactionPlan = {
  label: string;
  cluster: FeeEstimateCluster;
  instructions: LabeledTransactionInstruction[];
  checks: InstructionCheck[];
};

export type ShieldTokensInstructionPlan = {
  instructions: LabeledTransactionInstruction[];
  checks: InstructionCheck[];
  needsUndelegate: boolean;
  context: {
    amount: bigint;
    commitment: Commitment;
    requestedAmount: bigint;
    isNativeSol: boolean;
    validator: PublicKey;
    depositPda: PublicKey;
    permissionPda: PublicKey;
    depositAccountInfo: AccountInfo<Buffer> | null;
    permissionAccountInfo: AccountInfo<Buffer> | null;
  };
};

export type ShieldTokensTransactionPlan = {
  preUndelegateTransaction: LabeledTransactionPlan | null;
  baseTransaction: LabeledTransactionPlan;
  context: ShieldTokensInstructionPlan["context"];
};

export async function resolveShieldTokensAmount(params: {
  connection: Connection;
  tokenMint: PublicKey;
  requestedAmount: bigint;
  commitment?: Commitment;
}): Promise<bigint> {
  const commitment = params.commitment ?? DEFAULT_TRANSACTION_COMMITMENT;
  const snapshot = await fetchKaminoReserveSnapshot({
    commitment,
    connection: params.connection,
    tokenMint: params.tokenMint,
  });
  if (!snapshot) {
    return params.requestedAmount;
  }

  const amount = calculateKaminoDepositableLiquidityAmountRaw({
    snapshot,
    requestedLiquidityAmountRaw: params.requestedAmount,
  });
  if (amount <= 0n) {
    throw new Error(
      "USDC shield amount is too small to mint Kamino collateral shares"
    );
  }

  return amount;
}

export function labelTransactionInstructions(
  prefix: string,
  instructions: TransactionInstruction[]
): LabeledTransactionInstruction[] {
  const labels = [
    `${prefix}:createAssociatedTokenAccount`,
    `${prefix}:transfer`,
    `${prefix}:syncNative`,
  ];

  return instructions.map((ix, index) => ({
    label: labels[index] ?? `${prefix}:${index}`,
    ix,
  }));
}

export async function buildShieldTokensInstructionPlan(params: {
  user: PublicKey;
  payer: PublicKey;
  tokenMint: PublicKey;
  amount: bigint;
  commitment?: Commitment;
  baseProgram: Program<TelegramPrivateTransfer>;
  perProgram: Program<TelegramPrivateTransfer>;
  validator?: PublicKey;
}): Promise<ShieldTokensInstructionPlan> {
  const { user, payer, tokenMint, baseProgram, perProgram } = params;
  const requestedAmount = params.amount;
  const commitment = params.commitment ?? DEFAULT_TRANSACTION_COMMITMENT;

  const baseConnection = baseProgram.provider.connection;
  const perRpcEndpoint = perProgram.provider.connection.rpcEndpoint;

  const isNativeSol = tokenMint.equals(NATIVE_MINT);
  const validator =
    params.validator ?? getErValidatorForRpcEndpoint(perRpcEndpoint);
  const [depositPda] = findDepositPda(user, tokenMint);
  const [permissionPda] = findPermissionPda(depositPda);

  const [accountInfos, amount] = await Promise.all([
    getMultipleAccountsInfoWithRetry(
      baseConnection,
      [depositPda, permissionPda],
      "base-getMultipleAccountsInfo"
    ),
    resolveShieldTokensAmount({
      connection: baseConnection,
      tokenMint,
      requestedAmount,
      commitment,
    }),
  ]);
  const depositAccountInfo = accountInfos[0] ?? null;
  const permissionAccountInfo = accountInfos[1] ?? null;
  const needsUndelegate =
    depositAccountInfo?.owner.equals(DELEGATION_PROGRAM_ID) ?? false;
  const [
    depositRentLamports,
    modifyBalanceRentLamports,
    permissionRentLamports,
    delegationRentLamports,
  ] = await Promise.all([
    !depositAccountInfo
      ? estimateDepositRentLamports({ connection: baseConnection, depositPda })
      : Promise.resolve(0),
    estimateModifyBalanceRentLamports({
      connection: baseConnection,
      user,
      tokenMint,
      isNativeSol,
    }),
    !permissionAccountInfo
      ? estimatePermissionRentLamports({
          connection: baseConnection,
          permissionPda,
        })
      : Promise.resolve(0),
    estimateDepositDelegationRentLamports({
      connection: baseConnection,
      user,
      tokenMint,
      depositPda,
      forceCreate: needsUndelegate,
    }),
  ]);

  const instructions: LabeledTransactionInstruction[] = [];
  const checks: InstructionCheck[] = [];

  if (isNativeSol) {
    const wrapSolInstructions = labelTransactionInstructions(
      "wrapSol",
      wrapSolToWsolIx({
        user,
        payer,
        lamports: amount,
      })
    );
    const transferInstruction = wrapSolInstructions.find(
      (instruction) => instruction.label === "wrapSol:transfer"
    );
    if (transferInstruction) {
      transferInstruction.nativeLamports = Number(amount);
    }
    instructions.push(...wrapSolInstructions);
  }

  if (!depositAccountInfo) {
    const initializeDepositIxs = await initializeDepositIx(baseProgram, {
      tokenMint,
      user,
      payer,
    });
    instructions.push({
      label: "initializeDeposit",
      ix: initializeDepositIxs.ix,
      rentLamports: depositRentLamports,
    });
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
  instructions.push({
    label: "modifyBalanceIncrease",
    ix: modifyBalanceIxs.ix,
    rentLamports: modifyBalanceRentLamports,
  });
  checks.push(...modifyBalanceIxs.ensure);

  if (!permissionAccountInfo) {
    const createPermissionIxs = await createPermissionIx(baseProgram, {
      tokenMint,
      user,
      payer,
      passNotExist: true,
    });
    instructions.push({
      label: "createPermission",
      ix: createPermissionIxs.ix,
      rentLamports: permissionRentLamports,
    });
    checks.push(...createPermissionIxs.ensure);
  }

  const delegateDepositIxs = await delegateDepositIx(baseProgram, {
    tokenMint,
    user,
    payer,
    validator,
    passNotExist: true,
  });
  instructions.push({
    label: "delegateDeposit",
    ix: delegateDepositIxs.ix,
    rentLamports: delegationRentLamports,
  });
  checks.push(...delegateDepositIxs.ensure);

  // TODO: delegatePermissionIx

  if (isNativeSol) {
    instructions.push({
      label: "closeWsolAta",
      ix: closeWsolAta({
        user,
        destination: user,
      }),
    });
  }

  return {
    instructions,
    checks,
    needsUndelegate,
    context: {
      amount,
      commitment,
      requestedAmount,
      isNativeSol,
      validator,
      depositPda,
      permissionPda,
      depositAccountInfo,
      permissionAccountInfo,
    },
  };
}

export async function buildShieldTokensTransactionPlan(params: {
  user: PublicKey;
  payer: PublicKey;
  tokenMint: PublicKey;
  amount: bigint;
  commitment?: Commitment;
  baseProgram: Program<TelegramPrivateTransfer>;
  perProgram: Program<TelegramPrivateTransfer>;
  validator?: PublicKey;
  magicProgram?: PublicKey;
  magicContext?: PublicKey;
}): Promise<ShieldTokensTransactionPlan> {
  const instructionPlan = await buildShieldTokensInstructionPlan(params);
  let preUndelegateTransaction: LabeledTransactionPlan | null = null;

  if (instructionPlan.needsUndelegate) {
    const undelegateRentLamports =
      await estimateDepositDelegationRentCreditLamports({
        connection: params.baseProgram.provider.connection,
        depositPda: instructionPlan.context.depositPda,
      });
    const undelegateIxs = await undelegateDepositIx(params.perProgram, {
      user: params.user,
      payer: params.payer,
      tokenMint: params.tokenMint,
      magicProgram: params.magicProgram ?? MAGIC_PROGRAM_ID,
      magicContext: params.magicContext ?? MAGIC_CONTEXT_ID,
    });
    preUndelegateTransaction = {
      label: "shield:preUndelegate",
      cluster: "ephemeral",
      instructions: [
        {
          label: "undelegateDeposit",
          ix: undelegateIxs.ix,
          rentLamports: undelegateRentLamports,
        },
      ],
      checks: undelegateIxs.ensure,
    };
  }

  return {
    preUndelegateTransaction,
    baseTransaction: {
      label: "shield",
      cluster: "base",
      instructions: instructionPlan.instructions,
      checks: instructionPlan.checks,
    },
    context: instructionPlan.context,
  };
}

export async function shieldTokens(params: {
  user: PublicKey;
  payer: PublicKey;
  tokenMint: PublicKey;
  amount: bigint;
  baseProgram: Program<TelegramPrivateTransfer>;
  perProgram: Program<TelegramPrivateTransfer>;
  validator?: PublicKey;
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

  const plan = await buildShieldTokensTransactionPlan({
    user,
    payer,
    tokenMint,
    amount,
    commitment: rpcOptions?.preflightCommitment,
    baseProgram,
    perProgram,
    validator: params.validator,
    magicProgram: params.magicProgram,
    magicContext: params.magicContext,
  });
  const {
    context: {
      amount: effectiveAmount,
      validator,
      depositPda,
      permissionPda,
      depositAccountInfo,
      permissionAccountInfo,
      isNativeSol,
    },
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

  const delegationWatcher = waitForAccountOwnerChange(
    baseConnection,
    depositPda,
    DELEGATION_PROGRAM_ID
  );

  const tx = new Transaction().add(
    ...plan.baseTransaction.instructions.map(({ ix }) => ix)
  );
  let signature: string;
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
        amount: effectiveAmount,
        commitment: plan.context.commitment,
        requestedAmount: amount,
        isNativeSol,
        validator,
        depositPda,
        permissionPda,
        depositAccountInfo,
        permissionAccountInfo,
      },
    });
  } catch (e) {
    await delegationWatcher.cancel();
    throw e;
  }

  // Shield already landed on-chain. Waiting for the deposit PDA to get
  // re-owned by the delegation program is best-effort from here on —
  // if it times out or errors, we still return the signature. A hard
  // throw here surfaced as "Shield failed" in the UI even though the
  // tx succeeded (ASK-1134).
  try {
    await delegationWatcher.wait();
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  } catch (err) {
    console.warn(
      `[shieldTokens] delegation watcher did not observe owner change (signature=${signature}); continuing`,
      err
    );
  }

  return signature;
}
