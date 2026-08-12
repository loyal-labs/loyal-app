import { type Program } from "@coral-xyz/anchor";
import type { CheckedTransactionInstruction, ModifyBalanceParams } from "../types";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
export declare function modifyBalanceIx(program: Program<TelegramPrivateTransfer>, params: ModifyBalanceParams): Promise<CheckedTransactionInstruction>;
