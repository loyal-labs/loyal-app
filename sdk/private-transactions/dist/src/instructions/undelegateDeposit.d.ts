import type { Program } from "@coral-xyz/anchor";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import type { CheckedTransactionInstruction, UndelegateDepositParams } from "../types";
export declare function undelegateDepositIx(perProgram: Program<TelegramPrivateTransfer>, params: UndelegateDepositParams): Promise<CheckedTransactionInstruction>;
