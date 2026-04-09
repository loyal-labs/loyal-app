import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import * as SeedVault from "expo-seed-vault";
import { Buffer } from "buffer";

import type { Signer } from "./signer";

/**
 * Signer backed by the Solana Mobile Seed Vault.
 *
 * The seed never leaves the vault; each sign call delegates to the native
 * bridge, which prompts the user for biometric/PIN approval through the
 * vault's own system UI.
 *
 * Batch signing (for Jupiter swaps that return multiple transactions) is
 * currently sequential — the vault prompts once per transaction. A follow
 * up can wire up the vault's plural `signTransactions` API for a single
 * prompt across a batch.
 */
export class SeedVaultSigner implements Signer {
  readonly kind = "seed-vault" as const;
  readonly publicKey: PublicKey;

  constructor(
    readonly authToken: number,
    readonly derivationPath: string,
    publicKeyBase58: string,
  ) {
    this.publicKey = new PublicKey(publicKeyBase58);
  }

  async signMessage(bytes: Uint8Array): Promise<Uint8Array> {
    return SeedVault.signMessage({
      authToken: this.authToken,
      derivationPath: this.derivationPath,
      message: bytes,
    });
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    // The vault signs the message bytes, not the full serialized
    // transaction (which would include the empty signature slots).
    const messageBytes =
      tx instanceof VersionedTransaction
        ? tx.message.serialize()
        : (tx as Transaction).serializeMessage();

    const signature = await SeedVault.signTransaction({
      authToken: this.authToken,
      derivationPath: this.derivationPath,
      txBytes: messageBytes,
    });

    if (tx instanceof VersionedTransaction) {
      // Versioned transactions store signatures positionally. The fee
      // payer is at index 0 — we only support single-signer vault wallets.
      tx.signatures[0] = signature;
    } else {
      (tx as Transaction).addSignature(
        this.publicKey,
        Buffer.from(signature),
      );
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
}
