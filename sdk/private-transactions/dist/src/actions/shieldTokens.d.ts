import { type AccountInfo, type Commitment, type Connection, type PublicKey, type TransactionInstruction } from "@solana/web3.js";
import type { FeeEstimateCluster, InstructionCheck, RpcOptions } from "../types";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import type { Program } from "@coral-xyz/anchor";
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
export declare function resolveShieldTokensAmount(params: {
    connection: Connection;
    tokenMint: PublicKey;
    requestedAmount: bigint;
    commitment?: Commitment;
}): Promise<bigint>;
export declare function labelTransactionInstructions(prefix: string, instructions: TransactionInstruction[]): LabeledTransactionInstruction[];
export declare function buildShieldTokensInstructionPlan(params: {
    user: PublicKey;
    payer: PublicKey;
    tokenMint: PublicKey;
    amount: bigint;
    commitment?: Commitment;
    baseProgram: Program<TelegramPrivateTransfer>;
    perProgram: Program<TelegramPrivateTransfer>;
    validator?: PublicKey;
}): Promise<ShieldTokensInstructionPlan>;
export declare function buildShieldTokensTransactionPlan(params: {
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
}): Promise<ShieldTokensTransactionPlan>;
export declare function shieldTokens(params: {
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
}): Promise<string>;
