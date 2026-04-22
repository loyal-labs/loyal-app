import type { Program } from "@coral-xyz/anchor";
import type { UndelegateDepositParams } from "../types";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
/**
 * Undelegate a deposit account from the ephemeral rollup.
 * Waits for both base and ephemeral connections to confirm the deposit
 * is owned by PROGRAM_ID before returning.
 */
export declare function undelegateDeposit(baseProgram: Program<TelegramPrivateTransfer>, perProgram: Program<TelegramPrivateTransfer>, params: UndelegateDepositParams): Promise<string>;
