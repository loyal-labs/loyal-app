import type { Program } from "@coral-xyz/anchor";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import type { CheckedTransactionInstruction, InitializeDepositParams } from "../types";
export declare function initializeDepositIx(program: Program<TelegramPrivateTransfer>, params: InitializeDepositParams): Promise<CheckedTransactionInstruction>;
