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

/**
 * Thrown when a Privy login lands on a user whose only Solana wallets are
 * external (Seed Vault, Phantom, ...). The caller should send the user to
 * Connect Wallet rather than mint an embedded wallet next to their funds.
 */
export class PrivyExternalWalletError extends Error {
  constructor(readonly address: string) {
    super(
      `This account is linked to a wallet ending in ${address.slice(-4)}. Use Connect Wallet to sign in with it.`,
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
