import type { Program } from "@coral-xyz/anchor";
import { type PublicKey, type TransactionInstruction } from "@solana/web3.js";
import type { InstructionCheck, RpcOptions, UndelegateDepositParams } from "../types";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
export type PlannedUndelegateDepositTransaction = {
    label: string;
    instructions: {
        ix: TransactionInstruction;
    }[];
    checks: InstructionCheck[];
};
export declare function sendPlannedUndelegateDepositTransaction(params: {
    baseProgram: Program<TelegramPrivateTransfer>;
    perProgram: Program<TelegramPrivateTransfer>;
    transaction: PlannedUndelegateDepositTransaction;
    user: PublicKey;
    tokenMint: PublicKey;
    rpcOptions?: RpcOptions;
}): Promise<string>;
/**
 * Undelegate a deposit account from the ephemeral rollup.
 * Waits for both base and ephemeral connections to confirm the deposit
 * is owned by PROGRAM_ID before returning.
 */
export declare function undelegateDeposit(baseProgram: Program<TelegramPrivateTransfer>, perProgram: Program<TelegramPrivateTransfer>, params: UndelegateDepositParams): Promise<string>;
