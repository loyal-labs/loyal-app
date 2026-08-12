import {
  Connection,
  Keypair,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type { WalletSigner } from "@loyal-labs/wallet-core/types";

export function createKeypairSigner(
  keypair: Keypair,
  connection: Connection
): WalletSigner {
  return {
    publicKey: keypair.publicKey,

    async signTransaction<T extends Transaction | VersionedTransaction>(
      tx: T
    ): Promise<T> {
      if (tx instanceof Transaction) {
        tx.sign(keypair);
      } else {
        tx.sign([keypair]);
      }
      return tx;
    },

    async signAllTransactions<T extends Transaction | VersionedTransaction>(
      txs: T[]
    ): Promise<T[]> {
      for (const tx of txs) {
        if (tx instanceof Transaction) {
          tx.sign(keypair);
        } else {
          tx.sign([keypair]);
        }
      }
      return txs;
    },

    async signMessage(message: Uint8Array): Promise<Uint8Array> {
      const { sign } = await import("tweetnacl");
      return sign.detached(message, keypair.secretKey);
    },

    async sendTransaction(
      tx: Transaction | VersionedTransaction,
      options?: { skipPreflight?: boolean }
    ): Promise<string> {
      if (tx instanceof Transaction) {
        tx.sign(keypair);
        return connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: options?.skipPreflight,
        });
      } else {
        tx.sign([keypair]);
        return connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: options?.skipPreflight,
        });
      }
    },
  };
}
