import type { Program } from "@coral-xyz/anchor";
import type { CheckedTransactionInstruction, InitializeUsernameDepositParams } from "../types";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
export declare function initializeUsernameDepositIx(program: Program<TelegramPrivateTransfer>, params: InitializeUsernameDepositParams): Promise<CheckedTransactionInstruction>;
