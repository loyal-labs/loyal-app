import { type Commitment, type Connection, type PublicKey, type TransactionInstruction } from "@solana/web3.js";
import type { FeeEstimateCluster, InstructionCostEstimate, ShieldFlowTransactionFeeEstimate } from "./types";
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
export declare function estimatePlannedTransactionFees(params: {
    transactions: FeeEstimateTransactionPlan[];
    commitment?: Commitment;
}): Promise<{
    transactions: ShieldFlowTransactionFeeEstimate[];
    instructions: InstructionCostEstimate[];
    totalFeeLamports: number;
    totalRentLamports: number;
}>;
