import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import * as SeedVault from "expo-seed-vault";
import { Buffer } from "buffer";

import type { Signer } from "./signer";

// The vault caps signing requests per authorization intent
// (IMPLEMENTATION_LIMITS_MAX_SIGNING_REQUESTS — 3 on current Saga/Seeker
// devices). Larger batches are chunked: one prompt per chunk instead of one
// per transaction.
const MAX_SIGNING_REQUESTS_PER_PROMPT = 3;

// The vault signs the message bytes, not the full serialized transaction
// (which would include the empty signature slots).
function transactionMessageBytes(
  tx: Transaction | VersionedTransaction,
): Uint8Array {
  return tx instanceof VersionedTransaction
    ? tx.message.serialize()
    : tx.serializeMessage();
}

/**
 * Signer backed by the Solana Mobile Seed Vault.
 *
 * The seed never leaves the vault; each sign call delegates to the native
 * bridge, which prompts the user for biometric/PIN approval through the
 * vault's own system UI. Batch signing uses the vault's plural
 * `signTransactions` API — one prompt per chunk of transactions.
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
    const signature = await SeedVault.signTransaction({
      authToken: this.authToken,
      derivationPath: this.derivationPath,
      txBytes: transactionMessageBytes(tx),
    });
    this.applySignature(tx, signature);
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    for (
      let start = 0;
      start < txs.length;
      start += MAX_SIGNING_REQUESTS_PER_PROMPT
    ) {
      const chunk = txs.slice(start, start + MAX_SIGNING_REQUESTS_PER_PROMPT);
      const signatures = await SeedVault.signTransactions({
        authToken: this.authToken,
        derivationPath: this.derivationPath,
        txs: chunk.map(transactionMessageBytes),
      });
      if (signatures.length !== chunk.length) {
        throw new Error(
          "Seed Vault returned a mismatched number of signatures.",
        );
      }
      chunk.forEach((tx, index) => this.applySignature(tx, signatures[index]));
    }
    return txs;
  }

  private applySignature(
    tx: Transaction | VersionedTransaction,
    signature: Uint8Array,
  ): void {
    if (tx instanceof VersionedTransaction) {
      // Versioned transactions store signatures positionally. The fee
      // payer is at index 0 — we only support single-signer vault wallets.
      tx.signatures[0] = signature;
    } else {
      tx.addSignature(this.publicKey, Buffer.from(signature));
    }
  }
}
