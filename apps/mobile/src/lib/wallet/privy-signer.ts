import type { PrivyEmbeddedSolanaWalletProvider } from "@privy-io/expo";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";

import { WalletRejectedError } from "./rejection";
import type { Signer } from "./signer";

// Privy has no typed rejection class on the Expo provider; the SDK's own
// error codes are `exited_auth_flow` and EIP-1193 4001 ("user rejected").
export function isPrivyUserDecline(error: unknown): boolean {
  const e = error as { code?: unknown; eipCode?: unknown; message?: unknown };
  return (
    e?.code === "exited_auth_flow" ||
    e?.code === 4001 ||
    e?.eipCode === 4001 ||
    /user (rejected|cancel|declin|exited)/i.test(String(e?.message ?? ""))
  );
}

// Privy `wallet_client_type` → display name. Unlisted types (and "unknown")
// fall back to "another device" so we never name a wallet we cannot identify.
const WALLET_CLIENT_NAMES: Record<string, string> = {
  Loyal: "the Loyal browser extension",
  phantom: "Phantom",
  solflare: "Solflare",
  backpack: "Backpack",
  jupiter: "Jupiter",
  coinbase_wallet: "Coinbase Wallet",
  trust: "Trust Wallet",
  exodus: "Exodus",
  brave_wallet: "Brave Wallet",
};

export function walletClientDisplayName(clientType?: string): string | null {
  if (!clientType) return null;
  return WALLET_CLIENT_NAMES[clientType] ?? null;
}

/**
 * Thrown when a Privy login lands on a user whose primary Solana wallet is
 * external (Seed Vault, Phantom, a browser extension, ...). Privy holds only
 * the address, never the key, so the caller must connect that wallet from an
 * app on this phone rather than mint an embedded wallet next to the user's
 * funds. Message is a fallback for callers that do not handle it.
 */
export class PrivyExternalWalletError extends Error {
  constructor(
    readonly address: string,
    readonly clientType?: string,
  ) {
    super(
      `Connect the wallet ending in ${address.slice(-4)} to finish signing in.`,
    );
    this.name = "PrivyExternalWalletError";
  }
}

/**
 * Signer backed by the Privy embedded Solana wallet. The key lives in Privy's
 * TEE; every call round-trips through the SDK. Message and signature are
 * base64 on the wire (js-sdk-core signWithUserSigner contract).
 */
export class PrivyEmbeddedSigner implements Signer {
  readonly kind = "privy" as const;
  readonly publicKey: PublicKey;

  constructor(
    private readonly provider: PrivyEmbeddedSolanaWalletProvider,
    address: string,
  ) {
    this.publicKey = new PublicKey(address);
  }

  async signMessage(bytes: Uint8Array): Promise<Uint8Array> {
    try {
      const { signature } = await this.provider.request({
        method: "signMessage",
        params: { message: Buffer.from(bytes).toString("base64") },
      });
      return new Uint8Array(Buffer.from(signature, "base64"));
    } catch (error) {
      if (isPrivyUserDecline(error)) throw new WalletRejectedError();
      throw error;
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    try {
      const { signedTransaction } = await this.provider.request({
        method: "signTransaction",
        params: { transaction: tx },
      });
      return signedTransaction;
    } catch (error) {
      if (isPrivyUserDecline(error)) throw new WalletRejectedError();
      throw error;
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    const signed: T[] = [];
    for (const tx of txs) signed.push(await this.signTransaction(tx));
    return signed;
  }
}
