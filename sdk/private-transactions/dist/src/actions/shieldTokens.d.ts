import { type PublicKey } from "@solana/web3.js";
import type { RpcOptions } from "../types";
import type { TelegramPrivateTransfer } from "../idl/telegram_private_transfer";
import type { Program } from "@coral-xyz/anchor";
export declare function shieldTokens(params: {
    user: PublicKey;
    payer: PublicKey;
    tokenMint: PublicKey;
    amount: bigint;
    baseProgram: Program<TelegramPrivateTransfer>;
    perProgram: Program<TelegramPrivateTransfer>;
    rpcOptions?: RpcOptions;
}): Promise<string>;
