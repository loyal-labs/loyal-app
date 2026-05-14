import "server-only";

import bs58 from "bs58";

import { WalletAuthError } from "./wallet-auth-errors";

function decodeBase58(value: string, message: string, code: string): Uint8Array {
  try {
    return bs58.decode(value);
  } catch {
    throw new WalletAuthError(message, {
      code,
      status: 400,
    });
  }
}

export function decodeWalletAddress(walletAddress: string): Uint8Array {
  const decoded = decodeBase58(
    walletAddress,
    "Wallet address is invalid.",
    "invalid_wallet_address"
  );

  if (decoded.length !== 32) {
    throw new WalletAuthError("Wallet address is invalid.", {
      code: "invalid_wallet_address",
      status: 400,
    });
  }

  return decoded;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
  ) {
    return bytes.buffer;
  }

  return bytes.slice().buffer;
}

export async function verifyWalletSignature(args: {
  walletAddress: string;
  message: string;
  signature: string;
}): Promise<boolean> {
  try {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(decodeWalletAddress(args.walletAddress)),
      "Ed25519",
      false,
      ["verify"]
    );
    const signatureBytes = decodeBase58(
      args.signature,
      "Wallet signature is invalid.",
      "invalid_wallet_signature"
    );

    return crypto.subtle.verify(
      "Ed25519",
      publicKey,
      toArrayBuffer(signatureBytes),
      toArrayBuffer(new TextEncoder().encode(args.message))
    );
  } catch (error) {
    if (error instanceof WalletAuthError) {
      throw error;
    }

    return false;
  }
}
