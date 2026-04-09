import {
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

/**
 * Unified signing surface. Replaces raw Keypair access so wallet backends
 * (local encrypted keypair, Seeker Seed Vault, etc.) stay interchangeable
 * throughout the app.
 */
export interface Signer {
  readonly publicKey: PublicKey;
  readonly kind: "local" | "seed-vault";
  signMessage(bytes: Uint8Array): Promise<Uint8Array>;
  signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]>;
}

type TweetNaclSign = {
  detached: (message: Uint8Array, secretKey: Uint8Array) => Uint8Array;
};

// Lazy-loaded so tweetnacl's Buffer access never runs at module top-level.
async function getTweetNaclSign(): Promise<TweetNaclSign> {
  const mod = (await import("tweetnacl")) as unknown as {
    sign?: TweetNaclSign;
    default?: { sign?: TweetNaclSign };
  };
  if (typeof mod.sign?.detached === "function") return mod.sign;
  if (typeof mod.default?.sign?.detached === "function") {
    return mod.default.sign;
  }
  throw new Error("tweetnacl sign.detached is unavailable");
}

/**
 * Signer backed by an in-memory @solana/web3.js Keypair. Used for wallets
 * created or imported into the local encrypted store.
 */
export class LocalKeypairSigner implements Signer {
  readonly kind = "local" as const;

  constructor(readonly keypair: Keypair) {}

  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  async signMessage(bytes: Uint8Array): Promise<Uint8Array> {
    const sign = await getTweetNaclSign();
    return sign.detached(bytes, this.keypair.secretKey);
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    if (tx instanceof VersionedTransaction) {
      tx.sign([this.keypair]);
    } else {
      (tx as Transaction).partialSign(this.keypair);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    for (const tx of txs) {
      await this.signTransaction(tx);
    }
    return txs;
  }

  /**
   * Local-only: exposed so users can back up the secret key from the UI.
   * Not part of the Signer interface — callers must narrow on `kind`.
   */
  getSecretKeyHex(): string {
    return Array.from(this.keypair.secretKey)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}
