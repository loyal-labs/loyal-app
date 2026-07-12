import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { Web3MobileWallet } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { Buffer } from "buffer";
import type { TurboModule } from "react-native";
import { Platform, TurboModuleRegistry } from "react-native";

import { env } from "@/config/env";

import type { Signer } from "./signer";
import {
  clearMwaAccount,
  storeMwaAccount,
  type StoredMwaAccount,
} from "./mwa-account-storage";

const APP_IDENTITY = {
  name: "Loyal",
  uri: "https://askloyal.com",
};

// MWA has no localnet identifier; devnet is the closest for local development.
const MWA_CHAIN =
  env.solanaEnv === "mainnet" ? "solana:mainnet" : "solana:devnet";

const RECONNECT_MESSAGE =
  "Wallet authorization is no longer valid. Reset your wallet in Settings and reconnect your wallet.";

const SIGNING_CANCELLED_MESSAGE =
  "Signing was cancelled in your wallet app. Try again and approve each prompt without switching apps or locking the screen.";

const SIGNING_DECLINED_MESSAGE =
  "The request was declined in your wallet app. Try again and approve each prompt.";

/**
 * True only when the binary actually contains the MWA native module. The
 * package calls TurboModuleRegistry.getEnforcing at import time, which THROWS
 * on binaries without the module (pre-MWA builds and iOS receiving this
 * bundle via OTA) — so probe the registry directly and keep every package
 * import lazy behind this check.
 */
export function isMwaSupported(): boolean {
  if (Platform.OS !== "android") return false;
  return TurboModuleRegistry.get<TurboModule>("SolanaMobileWalletAdapter") != null;
}

async function getMwa() {
  return import("@solana-mobile/mobile-wallet-adapter-protocol-web3js");
}

// SolanaMobileWalletAdapter(Protocol)Error instances carry a `code` — string
// for session-level errors, negative number for wallet protocol errors.
// Property check instead of instanceof avoids coupling to the class exports.
function hasErrorCode(error: unknown, code: string | number): boolean {
  return (
    error instanceof Error &&
    (error as { code?: string | number }).code === code
  );
}

// The user backing out of the wallet's association or authorization UI is a
// choice, not a failure.
function isUserCancellation(error: unknown): boolean {
  return (
    hasErrorCode(error, "ERROR_ASSOCIATION_CANCELLED") ||
    hasErrorCode(error, -1) // ERROR_AUTHORIZATION_FAILED
  );
}

// A signing session torn down before approval (wallet sheet dismissed, screen
// locked, wallet app killed) reaches JS as a bare
// "java.util.concurrent.CancellationException" from the native module rather
// than a coded protocol error.
function isSessionCancellation(error: unknown): boolean {
  return (
    hasErrorCode(error, "ERROR_ASSOCIATION_CANCELLED") ||
    (error instanceof Error && error.message.includes("CancellationException"))
  );
}

type TweetNaclVerify = (
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
) => boolean;

// Lazy-loaded so tweetnacl's Buffer access never runs at module top-level
// (same pattern as signer.ts).
async function getTweetNaclVerify(): Promise<TweetNaclVerify> {
  const mod = (await import("tweetnacl")) as unknown as {
    sign?: { detached?: { verify?: TweetNaclVerify } };
    default?: { sign?: { detached?: { verify?: TweetNaclVerify } } };
  };
  const verify =
    mod.sign?.detached?.verify ?? mod.default?.sign?.detached?.verify;
  if (typeof verify !== "function") {
    throw new Error("tweetnacl sign.detached.verify is unavailable");
  }
  return verify;
}

function toBase64Address(publicKey: PublicKey): string {
  return Buffer.from(publicKey.toBytes()).toString("base64");
}

function fromBase64Address(address: string): string {
  return new PublicKey(Buffer.from(address, "base64")).toBase58();
}

/**
 * Open the wallet chooser and request a fresh authorization. Returns the
 * account to persist, or null when the user cancelled or declined in the
 * wallet app.
 */
export async function connectMwaWallet(): Promise<StoredMwaAccount | null> {
  try {
    const { transact } = await getMwa();
    return await transact(async (wallet) => {
      const result = await wallet.authorize({
        identity: APP_IDENTITY,
        chain: MWA_CHAIN,
      });
      const account = result.accounts[0];
      if (!account) throw new Error("The wallet did not share an account.");
      return {
        authToken: result.auth_token,
        publicKey: fromBase64Address(account.address),
        label: account.label,
      };
    });
  } catch (error) {
    if (isUserCancellation(error)) return null;
    if (hasErrorCode(error, "ERROR_WALLET_NOT_FOUND")) {
      throw new Error(
        "No compatible Solana wallet app was found. Install Phantom or Solflare and try again.",
      );
    }
    throw error;
  }
}

/** Best-effort disconnect used by wallet reset. Opens a wallet session. */
export async function deauthorizeMwaWallet(authToken: string): Promise<void> {
  const { transact } = await getMwa();
  await transact(async (wallet) => {
    await wallet.deauthorize({ auth_token: authToken });
  });
}

/**
 * Signer backed by an external wallet app over Mobile Wallet Adapter.
 *
 * Keys never reach this app; each sign call opens an MWA session with the
 * user's wallet app (Phantom, Solflare, Seed Vault Wallet, …), which shows
 * its own approval UI. Every session starts by reauthorizing with the stored
 * auth token — silent when the authorization is still valid. If the wallet
 * rotated the token it is persisted; if the wallet revoked our authorization
 * the stored account is cleared so the next launch lands in reconnect
 * onboarding, and a reconnect instruction is thrown instead of the raw error.
 */
export class MwaSigner implements Signer {
  readonly kind = "mwa" as const;
  readonly publicKey: PublicKey;

  constructor(
    public authToken: string,
    publicKeyBase58: string,
    readonly label?: string,
  ) {
    this.publicKey = new PublicKey(publicKeyBase58);
  }

  async signMessage(bytes: Uint8Array): Promise<Uint8Array> {
    const [signed] = await this.withWallet((wallet) =>
      wallet.signMessages({
        addresses: [toBase64Address(this.publicKey)],
        payloads: [bytes],
      }),
    );
    if (!signed) throw new Error("Wallet returned no signed message.");
    // MWA wallets return the signed payload — the message with the 64-byte
    // ed25519 signature appended (some return the bare signature, which the
    // same slice handles).
    return signed.slice(-64);
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    const [signed] = await this.signAllTransactions([tx]);
    return signed;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    const signed = await this.withWallet((wallet) =>
      wallet.signTransactions({ transactions: txs }),
    );
    if (signed.length !== txs.length) {
      throw new Error(
        "Wallet returned a mismatched number of signed transactions.",
      );
    }
    // The wallet-returned bytes are the signed truth — an MWA wallet may
    // return a modified transaction, so grafting only its signatures onto our
    // original message would break signature verification. Callers keep using
    // the objects they passed in (e.g. serializing the original after
    // signTransaction), so adopt the wallet's message AND signatures onto the
    // inputs, then verify our signature locally to fail with a precise error
    // instead of an opaque RPC preflight failure.
    for (let index = 0; index < txs.length; index++) {
      const tx = txs[index];
      const source = signed[index];
      if (tx instanceof VersionedTransaction) {
        const src = source as VersionedTransaction;
        tx.message = src.message;
        tx.signatures = src.signatures;
        await this.assertOwnSignature(tx, index);
      } else {
        (tx as Transaction).signatures = (source as Transaction).signatures;
      }
    }
    return txs;
  }

  private async assertOwnSignature(
    tx: VersionedTransaction,
    index: number,
  ): Promise<void> {
    const address = this.publicKey.toBase58();
    const signerIndex = tx.message.staticAccountKeys.findIndex((key) =>
      key.equals(this.publicKey),
    );
    if (
      signerIndex < 0 ||
      signerIndex >= tx.message.header.numRequiredSignatures
    ) {
      throw new Error(
        `Wallet returned transaction ${index + 1} without ${address} as a signer.`,
      );
    }
    const verify = await getTweetNaclVerify();
    const valid = verify(
      tx.message.serialize(),
      tx.signatures[signerIndex],
      this.publicKey.toBytes(),
    );
    if (!valid) {
      throw new Error(
        `The wallet returned an invalid signature for ${address} on transaction ${index + 1}. It may have signed with a different account — reset your wallet in Settings and reconnect.`,
      );
    }
  }

  private async withWallet<T>(
    op: (wallet: Web3MobileWallet) => Promise<T>,
  ): Promise<T> {
    const { transact } = await getMwa();
    try {
      return await transact(async (wallet) => {
        await this.reauthorize(wallet);
        return op(wallet);
      });
    } catch (error) {
      if (isSessionCancellation(error)) {
        throw new Error(SIGNING_CANCELLED_MESSAGE);
      }
      if (hasErrorCode(error, -3)) {
        // ERROR_NOT_SIGNED: the user tapped decline in the wallet app.
        throw new Error(SIGNING_DECLINED_MESSAGE);
      }
      throw error;
    }
  }

  private async reauthorize(wallet: Web3MobileWallet): Promise<void> {
    let result;
    try {
      result = await wallet.authorize({
        identity: APP_IDENTITY,
        chain: MWA_CHAIN,
        auth_token: this.authToken,
      });
    } catch (error) {
      // ERROR_AUTHORIZATION_FAILED: the wallet revoked our authorization
      // (the user disconnected this app). Transient session errors rethrow.
      if (!hasErrorCode(error, -1)) throw error;
      await clearMwaAccount();
      throw new Error(RECONNECT_MESSAGE);
    }
    const base64Address = toBase64Address(this.publicKey);
    if (!result.accounts.some((a) => a.address === base64Address)) {
      // The wallet reauthorized a different account than the one connected.
      await clearMwaAccount();
      throw new Error(RECONNECT_MESSAGE);
    }
    if (result.auth_token !== this.authToken) {
      this.authToken = result.auth_token;
      await storeMwaAccount({
        authToken: result.auth_token,
        publicKey: this.publicKey.toBase58(),
        label: this.label,
      });
    }
  }
}
