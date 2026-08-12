import type { Program } from "@coral-xyz/anchor";
import type { CheckedTransactionInstruction, DelegateDepositParams } from "../types";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
export declare function delegateDepositIx(program: Program<TelegramPrivateTransfer>, params: DelegateDepositParams): Promise<CheckedTransactionInstruction>;
