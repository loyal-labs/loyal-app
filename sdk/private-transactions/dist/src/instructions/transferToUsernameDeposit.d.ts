import { type Program } from "@coral-xyz/anchor";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import type { CheckedTransactionInstruction, TransferToUsernameDepositParams } from "../types";
export declare function transferToUsernameDepositIx(program: Program<TelegramPrivateTransfer>, params: TransferToUsernameDepositParams): Promise<CheckedTransactionInstruction>;
