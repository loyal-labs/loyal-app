"use client";

import type {
  SerializedSolanaSignInOutput,
  SolanaSignInInputJson,
} from "@loyal-labs/auth-core";
import type {
  SolanaSignInInput,
  SolanaSignInOutput,
} from "@solana/wallet-standard-features";
import { Transaction } from "@solana/web3.js";
import bs58 from "bs58";

export type WalletProofSignMessage =
  | ((message: Uint8Array) => Promise<Uint8Array>)
  | undefined;
export type WalletProofSignIn =
  | ((input?: SolanaSignInInput) => Promise<SolanaSignInOutput>)
  | undefined;
export type WalletProofSignTransaction =
  | ((transaction: Transaction) => Promise<Transaction>)
  | undefined;

export class WalletProofSignerError extends Error {
  readonly code: "wallet_signature_rejected" | "wallet_signing_unsupported";

  constructor(
    message: string,
    code: "wallet_signature_rejected" | "wallet_signing_unsupported"
  ) {
    super(message);
    this.name = "WalletProofSignerError";
    this.code = code;
  }
}

function isRejectedSignatureError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  return (
    message.includes("rejected") ||
    message.includes("declined") ||
    message.includes("cancelled") ||
    message.includes("canceled") ||
    message.includes("user denied")
  );
}

export async function signWalletProofMessage(args: {
  signMessage: WalletProofSignMessage;
  message: string;
}): Promise<string> {
  if (!args.signMessage) {
    throw new WalletProofSignerError(
      "This wallet does not support message signing.",
      "wallet_signing_unsupported"
    );
  }

  try {
    const signature = await args.signMessage(
      new TextEncoder().encode(args.message)
    );
    return bs58.encode(signature);
  } catch (error) {
    if (isRejectedSignatureError(error)) {
      throw new WalletProofSignerError(
        "You cancelled the wallet signature request.",
        "wallet_signature_rejected"
      );
    }

    throw error;
  }
}

function serializeBytes(bytes: ArrayLike<number>): number[] {
  return Array.from(bytes);
}

function serializeSignInOutput(
  output: SolanaSignInOutput
): SerializedSolanaSignInOutput {
  return {
    account: {
      address: output.account.address,
      publicKey: serializeBytes(output.account.publicKey),
      features: [...output.account.features],
      chains: [...output.account.chains],
      ...(output.account.label ? { label: output.account.label } : {}),
      ...(output.account.icon ? { icon: output.account.icon } : {}),
    },
    signedMessage: serializeBytes(output.signedMessage),
    signature: serializeBytes(output.signature),
    ...(output.signatureType ? { signatureType: output.signatureType } : {}),
  };
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function signWalletProofSignIn(args: {
  signIn: WalletProofSignIn;
  signInInput: SolanaSignInInputJson;
}): Promise<SerializedSolanaSignInOutput> {
  if (!args.signIn) {
    throw new WalletProofSignerError(
      "This wallet does not support Sign In With Solana.",
      "wallet_signing_unsupported"
    );
  }

  try {
    const output = await args.signIn(args.signInInput as SolanaSignInInput);
    return serializeSignInOutput(output);
  } catch (error) {
    if (isRejectedSignatureError(error)) {
      throw new WalletProofSignerError(
        "You cancelled the wallet sign-in request.",
        "wallet_signature_rejected"
      );
    }

    throw error;
  }
}

export async function signWalletProofTransaction(args: {
  signTransaction: WalletProofSignTransaction;
  transaction: string;
}): Promise<string> {
  if (!args.signTransaction) {
    throw new WalletProofSignerError(
      "This wallet does not support transaction signing.",
      "wallet_signing_unsupported"
    );
  }

  try {
    const transaction = Transaction.from(base64ToBytes(args.transaction));
    const signedTransaction = await args.signTransaction(transaction);
    return bytesToBase64(
      signedTransaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      })
    );
  } catch (error) {
    if (isRejectedSignatureError(error)) {
      throw new WalletProofSignerError(
        "You cancelled the wallet transaction request.",
        "wallet_signature_rejected"
      );
    }

    throw error;
  }
}
