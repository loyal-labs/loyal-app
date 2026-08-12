import { type Program } from "@coral-xyz/anchor";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import type { CheckedTransactionInstruction, DelegateUsernameDepositParams } from "../types";
export declare function delegateUsernameDepositIx(program: Program<TelegramPrivateTransfer>, params: DelegateUsernameDepositParams): Promise<CheckedTransactionInstruction>;
