import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import * as SeedVault from "expo-seed-vault";
import { Buffer } from "buffer";

import { WalletRejectedError } from "./rejection";
import type { Signer } from "./signer";
import { clearVaultAccount, storeVaultAccount } from "./vault-account-storage";
import { WalletSessionError } from "./wallet-session-error";

// The vault caps signing requests per authorization intent
// (IMPLEMENTATION_LIMITS_MAX_SIGNING_REQUESTS — 3 on current Saga/Seeker
// devices). Larger batches are chunked: one prompt per chunk instead of one
// per transaction.
const MAX_SIGNING_REQUESTS_PER_PROMPT = 3;

// WalletContractV1.RESULT_INVALID_AUTH_TOKEN (RESULT_FIRST_USER + 1001).
// The vault returns it when our auth token is stale or the user deauthorized
// the app; the SDK surfaces it as "sign… failed with result=1002".
const INVALID_AUTH_TOKEN_RESULT = /\bresult=1002\b/;

// Activity.RESULT_CANCELED. The vault's system UI returns it when the user
// dismisses the biometric/PIN sheet or taps deny, and the SDK surfaces it
// through the same "…failed with result=<code>" message as 1002 above.
const USER_DECLINED_RESULT = /\bresult=0\b/;

const RECONNECT_MESSAGE =
  "Seed Vault authorization is no longer valid. Reset your wallet in Settings and reconnect your wallet.";

const DECLINED_MESSAGE =
  "The signing request was declined in Seed Vault. Try again and approve the prompt.";

function isInvalidAuthTokenError(error: unknown): boolean {
  return (
    error instanceof Error && INVALID_AUTH_TOKEN_RESULT.test(error.message)
  );
}

/**
 * True when a vault call failed because the user dismissed or denied its
 * system UI. Exported so non-signer vault calls (the connect-time seed picker
 * in OnboardingGate) can classify a back-out the same way.
 */
export function isSeedVaultUserDecline(error: unknown): boolean {
  return error instanceof Error && USER_DECLINED_RESULT.test(error.message);
}

function nativeErrorCode(error: unknown): string | number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number"
    ? code
    : undefined;
}

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
 *
 * If the vault rejects our auth token (RESULT_INVALID_AUTH_TOKEN), the
 * signer recovers the live token for the same address from the vault's
 * authorized-seeds table, persists it, and retries once. If no live
 * authorization exists (the user deauthorized the app), the stored vault
 * account is cleared so the next launch lands in reconnect onboarding, and
 * a reconnect instruction is thrown instead of the raw vault error.
 */
export class SeedVaultSigner implements Signer {
  readonly kind = "seed-vault" as const;
  readonly publicKey: PublicKey;

  constructor(
    public authToken: string,
    readonly derivationPath: string,
    publicKeyBase58: string,
  ) {
    this.publicKey = new PublicKey(publicKeyBase58);
  }

  async signMessage(bytes: Uint8Array): Promise<Uint8Array> {
    try {
      return await this.withAuthTokenRecovery(() =>
        SeedVault.signMessage({
          authToken: this.authToken,
          derivationPath: this.derivationPath,
          message: bytes,
        }),
      );
    } catch (error) {
      const code = nativeErrorCode(error);
      if (code !== undefined) {
        throw new WalletSessionError("signing_failed", code, error);
      }
      throw error;
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    const signature = await this.withAuthTokenRecovery(() =>
      SeedVault.signTransaction({
        authToken: this.authToken,
        derivationPath: this.derivationPath,
        txBytes: transactionMessageBytes(tx),
      }),
    );
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
      const signatures = await this.withAuthTokenRecovery(() =>
        SeedVault.signTransactions({
          authToken: this.authToken,
          derivationPath: this.derivationPath,
          txs: chunk.map(transactionMessageBytes),
        }),
      );
      if (signatures.length !== chunk.length) {
        throw new Error(
          "Seed Vault returned a mismatched number of signatures.",
        );
      }
      chunk.forEach((tx, index) => this.applySignature(tx, signatures[index]));
    }
    return txs;
  }

  /**
   * Run a vault operation; on RESULT_INVALID_AUTH_TOKEN refresh the token
   * from the vault and retry once. The operation must read `this.authToken`
   * at call time so the retry picks up the refreshed token.
   */
  private async withAuthTokenRecovery<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      if (isSeedVaultUserDecline(error)) {
        throw new WalletRejectedError(DECLINED_MESSAGE);
      }
      if (!isInvalidAuthTokenError(error)) throw error;
      if (await this.refreshAuthToken()) {
        try {
          return await op();
        } catch (retryError) {
          if (isSeedVaultUserDecline(retryError)) {
            throw new WalletRejectedError(DECLINED_MESSAGE);
          }
          if (!isInvalidAuthTokenError(retryError)) throw retryError;
        }
      }
      await clearVaultAccount();
      throw new Error(RECONNECT_MESSAGE);
    }
  }

  /**
   * Look up the vault's live authorization for this signer's address and
   * adopt its token. Returns false when the vault holds no usable
   * replacement (app deauthorized, or the "fresh" token is the one that
   * just failed).
   */
  private async refreshAuthToken(): Promise<boolean> {
    const seeds = await SeedVault.listAuthorizedSeeds(this.derivationPath);
    const match = seeds.find(
      (seed) => seed.publicKey === this.publicKey.toBase58(),
    );
    if (!match || match.authToken === this.authToken) return false;
    this.authToken = match.authToken;
    await storeVaultAccount({
      authToken: match.authToken,
      derivationPath: this.derivationPath,
      publicKey: match.publicKey,
    });
    return true;
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
