"use client";

import {
  BaseMessageSignerWalletAdapter,
  WalletConnectionError,
  WalletDisconnectionError,
  WalletNotConnectedError,
  WalletReadyState,
  WalletSignMessageError,
  WalletSignTransactionError,
  type SupportedTransactionVersions,
  type WalletName,
} from "@solana/wallet-adapter-base";
import {
  Keypair,
  type PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

const DEV_WALLET_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23111'/%3E%3Cpath d='M18 35.5 29 18h17L35 35.5h11L35 49H18l11-13.5H18Z' fill='%23fff'/%3E%3C/svg%3E";

export const DEV_KEYPAIR_WALLET_NAME =
  "Local Dev Keypair" as WalletName<"Local Dev Keypair">;

const DEV_KEYPAIR_GLOBAL_KEY = "__loyalDevKeypair";

type DevKeypairGlobal = typeof globalThis & {
  [DEV_KEYPAIR_GLOBAL_KEY]?: Keypair | null;
};

function getImportedKeypair() {
  return (globalThis as DevKeypairGlobal)[DEV_KEYPAIR_GLOBAL_KEY] ?? null;
}

function setImportedKeypair(keypair: Keypair | null) {
  (globalThis as DevKeypairGlobal)[DEV_KEYPAIR_GLOBAL_KEY] = keypair;
}

function parseJsonSecretKey(input: string): Uint8Array | null {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (value) =>
          typeof value !== "number" ||
          !Number.isInteger(value) ||
          value < 0 ||
          value > 255
      )
    ) {
      return null;
    }
    return Uint8Array.from(parsed);
  } catch {
    return null;
  }
}

function parseHexSecretKey(input: string): Uint8Array | null {
  const normalized = input.startsWith("0x") ? input.slice(2) : input;
  if (!/^[\da-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    return null;
  }

  return Uint8Array.from(Buffer.from(normalized, "hex"));
}

export function parseDevSecretKeyInput(input: string): Keypair {
  const trimmed = input.trim();
  let secretKey: Uint8Array | null;
  if (trimmed.startsWith("[")) {
    secretKey = parseJsonSecretKey(trimmed);
  } else if (/^(0x)?[\da-fA-F]+$/.test(trimmed)) {
    secretKey = parseHexSecretKey(trimmed);
  } else {
    secretKey = bs58.decode(trimmed);
  }

  if (!secretKey || secretKey.byteLength !== 64) {
    throw new Error("Expected a 64-byte secret key.");
  }

  try {
    return Keypair.fromSecretKey(secretKey);
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Invalid secret key."
    );
  }
}

export function setDevKeypairSecretInput(input: string): PublicKey {
  const keypair = parseDevSecretKeyInput(input);
  setImportedKeypair(keypair);
  return keypair.publicKey;
}

export function clearDevKeypairSecret() {
  setImportedKeypair(null);
}

export class DevKeypairWalletAdapter extends BaseMessageSignerWalletAdapter<"Local Dev Keypair"> {
  readonly name = DEV_KEYPAIR_WALLET_NAME;
  readonly url = "http://localhost";
  readonly icon = DEV_WALLET_ICON;
  readonly readyState = WalletReadyState.Installed;
  readonly supportedTransactionVersions: SupportedTransactionVersions =
    new Set(["legacy", 0]);

  private keypair: Keypair | null = null;
  connecting = false;

  get publicKey() {
    return this.keypair?.publicKey ?? null;
  }

  async autoConnect() {
    if (getImportedKeypair()) {
      await this.connect();
    }
  }

  async connect() {
    if (this.connected || this.connecting) {
      return;
    }

    this.connecting = true;
    try {
      const importedKeypair = getImportedKeypair();
      if (!importedKeypair) {
        throw new WalletConnectionError("Import a local dev keypair first.");
      }

      this.keypair = importedKeypair;
      this.emit("connect", this.keypair.publicKey);
    } catch (error) {
      const walletError =
        error instanceof WalletConnectionError
          ? error
          : new WalletConnectionError(
              error instanceof Error ? error.message : "Failed to connect."
            );
      this.emit("error", walletError);
      throw walletError;
    } finally {
      this.connecting = false;
    }
  }

  async disconnect() {
    try {
      this.keypair = null;
      clearDevKeypairSecret();
      this.emit("disconnect");
    } catch (error) {
      const walletError = new WalletDisconnectionError(
        error instanceof Error ? error.message : "Failed to disconnect."
      );
      this.emit("error", walletError);
      throw walletError;
    }
  }

  async signMessage(message: Uint8Array) {
    if (!this.keypair) {
      throw new WalletNotConnectedError();
    }

    try {
      return nacl.sign.detached(message, this.keypair.secretKey);
    } catch (error) {
      throw new WalletSignMessageError(
        error instanceof Error ? error.message : "Failed to sign message."
      );
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T
  ): Promise<T> {
    if (!this.keypair) {
      throw new WalletNotConnectedError();
    }

    try {
      if ("version" in transaction) {
        transaction.sign([this.keypair]);
      } else {
        transaction.partialSign(this.keypair);
      }
      return transaction;
    } catch (error) {
      throw new WalletSignTransactionError(
        error instanceof Error ? error.message : "Failed to sign transaction."
      );
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[]
  ): Promise<T[]> {
    if (!this.keypair) {
      throw new WalletNotConnectedError();
    }

    return Promise.all(
      transactions.map((transaction) => this.signTransaction(transaction))
    );
  }
}
