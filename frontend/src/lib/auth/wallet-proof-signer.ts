"use client";

import type {
  SerializedSolanaSignInOutput,
  SolanaSignInInputJson,
} from "@loyal-labs/auth-core";
import type {
  SolanaSignInInput,
  SolanaSignInOutput,
} from "@solana/wallet-standard-features";
import { Transaction, type PublicKey } from "@solana/web3.js";
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

const ENABLE_WALLET_AUTH_TRANSACTION_DEBUG_LOGS =
  process.env.NODE_ENV === "development";

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

function summarizePublicKey(publicKey: PublicKey): string {
  const address = publicKey.toBase58();
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function logSignedWalletAuthTransaction(transaction: Transaction) {
  if (!ENABLE_WALLET_AUTH_TRANSACTION_DEBUG_LOGS) {
    return;
  }

  console.info("[wallet-proof-signer] wallet returned proof transaction", {
    feePayer: transaction.feePayer
      ? summarizePublicKey(transaction.feePayer)
      : null,
    instructionCount: transaction.instructions.length,
    instructions: transaction.instructions.map((instruction, index) => ({
      dataLength: instruction.data.length,
      index,
      keyCount: instruction.keys.length,
      keys: instruction.keys.map((key) => ({
        isSigner: key.isSigner,
        isWritable: key.isWritable,
        pubkey: summarizePublicKey(key.pubkey),
      })),
      programId: instruction.programId.toBase58(),
    })),
    signatures: transaction.signatures.map((signature) => ({
      hasSignature: Boolean(signature.signature),
      pubkey: summarizePublicKey(signature.publicKey),
    })),
  });
}

function assertTransactionWasSigned(transaction: Transaction) {
  const feePayer = transaction.feePayer?.toBase58();
  const feePayerSignature = feePayer
    ? transaction.signatures.find(
        (signature) => signature.publicKey.toBase58() === feePayer
      )
    : undefined;

  if (!feePayer || !feePayerSignature?.signature) {
    throw new WalletProofSignerError(
      "Your wallet did not sign the Ledger verification transaction.",
      "wallet_signing_unsupported"
    );
  }

  if (!transaction.verifySignatures(true)) {
    throw new WalletProofSignerError(
      "Your wallet returned an invalid Ledger verification signature.",
      "wallet_signing_unsupported"
    );
  }
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
    logSignedWalletAuthTransaction(signedTransaction);
    assertTransactionWasSigned(signedTransaction);
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
