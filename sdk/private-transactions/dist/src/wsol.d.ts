import { type PublicKey, type TransactionInstruction } from "@solana/web3.js";
export declare function wrapSolToWsolIx({ user, payer, lamports, }: {
    user: PublicKey;
    payer: PublicKey;
    lamports: bigint;
}): TransactionInstruction[];
export declare function closeWsolAta({ user, destination, }: {
    user: PublicKey;
    destination: PublicKey;
}): TransactionInstruction;
