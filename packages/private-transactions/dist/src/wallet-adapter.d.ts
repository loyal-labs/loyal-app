import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { type WalletSigner, type WalletLike } from "./types";
/**
 * Internal wallet adapter that normalizes different wallet types
 * to a common interface compatible with AnchorProvider
 */
export declare class InternalWalletAdapter implements WalletLike {
    private readonly signer;
    readonly publicKey: PublicKey;
    private constructor();
    /**
     * Create an adapter from any supported wallet type
     */
    static from(signer: WalletSigner): InternalWalletAdapter;
    /**
     * Extract public key from any supported wallet type
     */
    static getPublicKey(signer: WalletSigner): PublicKey;
    /**
     * Sign a single transaction
     */
    signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
    /**
     * Sign multiple transactions
     */
    signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
    /**
     * Sign a transaction with a Keypair
     */
    private signWithKeypair;
}
