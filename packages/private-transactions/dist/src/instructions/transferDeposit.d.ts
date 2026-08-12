import { type Program } from "@coral-xyz/anchor";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import type { CheckedTransactionInstruction, TransferDepositParams } from "../types";
export declare function transferDepositIx(program: Program<TelegramPrivateTransfer>, params: TransferDepositParams): Promise<CheckedTransactionInstruction>;
