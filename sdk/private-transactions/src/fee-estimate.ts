import {
  Transaction,
  type Commitment,
  type Connection,
  type PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import type {
  FeeEstimateCluster,
  InstructionCostEstimate,
  ShieldFlowTransactionFeeEstimate,
} from "./types";

export type FeeEstimateInstructionPlan = {
  label: string;
  ix: TransactionInstruction;
  rentLamports?: number;
};

export type FeeEstimateTransactionPlan = {
  label: string;
  cluster: FeeEstimateCluster;
  connection: Connection;
  feePayer: PublicKey;
  instructions: FeeEstimateInstructionPlan[];
};

function createUnsignedTransaction(params: {
  feePayer: PublicKey;
  blockhash: string;
  instructions: TransactionInstruction[];
}): Transaction {
  return new Transaction({
    feePayer: params.feePayer,
    recentBlockhash: params.blockhash,
  }).add(...params.instructions);
}

async function getMessageFeeLamports(params: {
  connection: Connection;
  transaction: Transaction;
  commitment?: Commitment;
}): Promise<number> {
  const fee = await params.connection.getFeeForMessage(
    params.transaction.compileMessage(),
    params.commitment
  );

  if (fee.value === null) {
    throw new Error("RPC returned null fee for transaction message");
  }

  return fee.value;
}

export async function estimatePlannedTransactionFees(params: {
  transactions: FeeEstimateTransactionPlan[];
  commitment?: Commitment;
}): Promise<{
  transactions: ShieldFlowTransactionFeeEstimate[];
  instructions: InstructionCostEstimate[];
  totalFeeLamports: number;
  totalRentLamports: number;
}> {
  const transactionEstimates = await Promise.all(
    params.transactions.map(async (transactionPlan, index) => {
      if (transactionPlan.instructions.length === 0) {
        throw new Error(
          `Cannot estimate empty transaction: ${transactionPlan.label}`
        );
      }

      const blockhash = await transactionPlan.connection.getLatestBlockhash(
        params.commitment
      );
      const transaction = createUnsignedTransaction({
        feePayer: transactionPlan.feePayer,
        blockhash: blockhash.blockhash,
        instructions: transactionPlan.instructions.map(({ ix }) => ix),
      });
      const feeLamports = await getMessageFeeLamports({
        connection: transactionPlan.connection,
        transaction,
        commitment: params.commitment,
      });

      const instructions = transactionPlan.instructions.map(
        (instructionPlan, instructionIndex) => ({
          transactionIndex: index,
          instructionIndex,
          label: instructionPlan.label,
          programId: instructionPlan.ix.programId,
          rentLamports: instructionPlan.rentLamports ?? 0,
        })
      );
      const rentLamports = instructions.reduce(
        (total, instruction) => total + instruction.rentLamports,
        0
      );

      return {
        index,
        label: transactionPlan.label,
        cluster: transactionPlan.cluster,
        feePayer: transactionPlan.feePayer,
        blockhash: blockhash.blockhash,
        lastValidBlockHeight: blockhash.lastValidBlockHeight,
        instructionCount: transactionPlan.instructions.length,
        feeLamports,
        rentLamports,
        instructions,
      };
    })
  );
  const instructionEstimates = transactionEstimates.flatMap(
    (transaction) => transaction.instructions
  );

  return {
    transactions: transactionEstimates,
    instructions: instructionEstimates,
    totalFeeLamports: transactionEstimates.reduce(
      (total, transaction) => total + transaction.feeLamports,
      0
    ),
    totalRentLamports: instructionEstimates.reduce(
      (total, instruction) => total + instruction.rentLamports,
      0
    ),
  };
}
