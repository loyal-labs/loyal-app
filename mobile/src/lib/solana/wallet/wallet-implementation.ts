import type {
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import type { Signer } from "@/lib/wallet/signer";

/**
 * Thin WalletLike adapter over a Signer, suitable for AnchorProvider.
 * Delegates all signing to the underlying signer (local keypair or vault).
 */
export class SimpleWallet {
  constructor(readonly signer: Signer) {}

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    return this.signer.signTransaction(tx);
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    return this.signer.signAllTransactions(txs);
  }

  get publicKey(): PublicKey {
    return this.signer.publicKey;
  }
}
