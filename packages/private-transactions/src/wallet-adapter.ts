import {
  PublicKey,
  Transaction,
  VersionedTransaction,
  Keypair,
} from "@solana/web3.js";
import type { AnchorProvider } from "@coral-xyz/anchor";
import {
  type WalletSigner,
  type WalletLike,
  isKeypair,
  isAnchorProvider,
} from "./types";

/**
 * Internal wallet adapter that normalizes different wallet types
 * to a common interface compatible with AnchorProvider
 */
export class InternalWalletAdapter implements WalletLike {
  readonly publicKey: PublicKey;

  private constructor(
    private readonly signer: WalletSigner,
    publicKey: PublicKey
  ) {
    this.publicKey = publicKey;
  }

  /**
   * Create an adapter from any supported wallet type
   */
  static from(signer: WalletSigner): InternalWalletAdapter {
    const publicKey = InternalWalletAdapter.getPublicKey(signer);
    return new InternalWalletAdapter(signer, publicKey);
  }

  /**
   * Extract public key from any supported wallet type
   */
  static getPublicKey(signer: WalletSigner): PublicKey {
    if (isKeypair(signer)) {
      return signer.publicKey;
    }
    if (isAnchorProvider(signer)) {
      return signer.wallet.publicKey;
    }
    // WalletLike
    return signer.publicKey;
  }

  /**
   * Sign a single transaction
   */
  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T
  ): Promise<T> {
    if (isKeypair(this.signer)) {
      return this.signWithKeypair(tx, this.signer);
    }

    if (isAnchorProvider(this.signer)) {
      return this.signer.wallet.signTransaction(tx);
    }

    // WalletLike (wallet adapter)
    return this.signer.signTransaction(tx);
  }

  /**
   * Sign multiple transactions
   */
  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]> {
    if (isKeypair(this.signer)) {
      return txs.map((tx) => this.signWithKeypair(tx, this.signer as Keypair));
    }

    if (isAnchorProvider(this.signer)) {
      return this.signer.wallet.signAllTransactions(txs);
    }

    // WalletLike (wallet adapter)
    return this.signer.signAllTransactions(txs);
  }

  /**
   * Sign a transaction with a Keypair
   */
  private signWithKeypair<T extends Transaction | VersionedTransaction>(
    tx: T,
    keypair: Keypair
  ): T {
    if (tx instanceof VersionedTransaction) {
      tx.sign([keypair]);
    } else {
      (tx as Transaction).partialSign(keypair);
    }
    return tx;
  }
}
