import type { Program } from "@coral-xyz/anchor";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import type { CheckedTransactionInstruction, CreatePermissionParams } from "../types";
export declare function createPermissionIx(program: Program<TelegramPrivateTransfer>, params: CreatePermissionParams): Promise<CheckedTransactionInstruction>;
