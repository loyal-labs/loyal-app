import { type PublicKey } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import type { InstructionCheck, RpcOptions } from "../types";
import { type LabeledTransactionInstruction, type LabeledTransactionPlan } from "./shieldTokens";
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
export declare function buildUnshieldTokensInstructionPlan(params: {
    user: PublicKey;
    payer: PublicKey;
    tokenMint: PublicKey;
    amount: bigint;
    baseProgram: Program<TelegramPrivateTransfer>;
    perProgram: Program<TelegramPrivateTransfer>;
    validator?: PublicKey;
}): Promise<UnshieldTokensInstructionPlan>;
export declare function buildUnshieldTokensTransactionPlan(params: {
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
}): Promise<UnshieldTokensTransactionPlan>;
/**
 * Unshield tokens: move from a Loyal private deposit back to a regular wallet.
 * If the deposit is delegated, this first commits it back to base, then sends
 * one base transaction for withdraw/native-SOL close/redelegate.
 */
export declare function unshieldTokens(params: {
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
}): Promise<string>;
