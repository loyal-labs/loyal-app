import { browser } from "#imports";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { WalletSigner } from "@loyal-labs/wallet-core/types";

// ---------------------------------------------------------------------------
// Message types for cross-context transaction signing
// ---------------------------------------------------------------------------

export interface SignTransactionRequest {
  type: "SIGN_TRANSACTION";
  id: string;
  serializedTx: number[];
  isVersioned: boolean;
}

export interface SignTransactionResponse {
  type: "SIGN_TRANSACTION_RESPONSE";
  id: string;
  serializedTx?: number[];
  error?: string;
}

// ---------------------------------------------------------------------------
// ExternalWalletSigner — signs transactions via message-passing to a browser
// tab where the Solana Wallet Adapter has access to the connected wallet.
// ---------------------------------------------------------------------------

export function createExternalWalletSigner(
  publicKeyBase58: string
): WalletSigner {
  const pubkey = new PublicKey(publicKeyBase58);

  return {
    publicKey: pubkey,

    async signTransaction<T extends Transaction | VersionedTransaction>(
      tx: T
    ): Promise<T> {
      const isVersioned = tx instanceof VersionedTransaction;
      const serialized = isVersioned
        ? Array.from(tx.serialize())
        : Array.from(
            (tx as Transaction).serialize({
              requireAllSignatures: false,
            })
          );

      const id = crypto.randomUUID();

      const response: SignTransactionResponse =
        await browser.runtime.sendMessage({
          type: "SIGN_TRANSACTION",
          id,
          serializedTx: serialized,
          isVersioned,
        } satisfies SignTransactionRequest);

      if (response.error) {
        throw new Error(response.error);
      }
      if (!response.serializedTx) {
        throw new Error("No signed transaction returned");
      }

      const signedBytes = new Uint8Array(response.serializedTx);
      if (isVersioned) {
        return VersionedTransaction.deserialize(signedBytes) as T;
      }
      return Transaction.from(signedBytes) as T;
    },

    async signAllTransactions<T extends Transaction | VersionedTransaction>(
      txs: T[]
    ): Promise<T[]> {
      const results: T[] = [];
      for (const tx of txs) {
        results.push(await this.signTransaction(tx));
      }
      return results;
    },
  };
}
