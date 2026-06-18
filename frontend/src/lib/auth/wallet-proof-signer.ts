"use client";

import bs58 from "bs58";

export type WalletProofSignMessage =
  | ((message: Uint8Array) => Promise<Uint8Array>)
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
