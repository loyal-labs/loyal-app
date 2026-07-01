"use client";

import type { AuthSessionUser } from "@loyal-labs/auth-core";

import type { AuthApiClient } from "@/lib/auth/client";
import {
  type WalletProofSignIn,
  type WalletProofSignMessage,
  type WalletProofSignTransaction,
  signWalletProofSignIn,
  signWalletProofMessage,
  signWalletProofTransaction,
} from "@/lib/auth/wallet-proof-signer";

type WalletProofStatus = "awaiting_signature" | "verifying";

type WalletProofFlowArgs = {
  authApiClient: AuthApiClient;
  messageSigner: WalletProofSignMessage | undefined;
  onStatusChange?: (status: WalletProofStatus) => void;
  turnstileToken?: string;
  walletAddress: string;
};

const inFlightProofs = new Map<string, Promise<AuthSessionUser>>();

export async function runWalletMessageProofFlow({
  authApiClient,
  messageSigner,
  onStatusChange,
  turnstileToken,
  walletAddress,
}: WalletProofFlowArgs): Promise<AuthSessionUser> {
  const existingProof = inFlightProofs.get(walletAddress);
  if (existingProof) {
    onStatusChange?.("awaiting_signature");
    return existingProof;
  }

  const proof = (async () => {
    const challenge = await authApiClient.challengeWalletAuth({
      walletAddress,
      turnstileToken,
    });

    if (challenge.kind === "siws" || challenge.kind === "transaction") {
      throw new Error("The auth server returned an invalid message challenge.");
    }

    onStatusChange?.("awaiting_signature");
    const signature = await signWalletProofMessage({
      signMessage: messageSigner,
      message: challenge.message,
    });

    onStatusChange?.("verifying");
    return authApiClient.completeWalletAuth({
      challengeToken: challenge.challengeToken,
      signature,
    });
  })();

  inFlightProofs.set(walletAddress, proof);

  try {
    return await proof;
  } finally {
    if (inFlightProofs.get(walletAddress) === proof) {
      inFlightProofs.delete(walletAddress);
    }
  }
}

export async function runWalletTransactionProofFlow({
  authApiClient,
  onStatusChange,
  signTransaction,
  turnstileToken,
  walletAddress,
}: {
  authApiClient: AuthApiClient;
  onStatusChange?: (status: WalletProofStatus) => void;
  signTransaction: WalletProofSignTransaction;
  turnstileToken?: string;
  walletAddress: string;
}): Promise<AuthSessionUser> {
  const inFlightKey = `transaction:${walletAddress}`;
  const existingProof = inFlightProofs.get(inFlightKey);
  if (existingProof) {
    onStatusChange?.("awaiting_signature");
    return existingProof;
  }

  const proof = (async () => {
    const challenge = await authApiClient.challengeWalletAuth({
      kind: "transaction",
      turnstileToken,
      walletAddress,
    });

    if (challenge.kind !== "transaction") {
      throw new Error(
        "The auth server returned an invalid transaction challenge."
      );
    }

    onStatusChange?.("awaiting_signature");
    const signedTransaction = await signWalletProofTransaction({
      signTransaction,
      transaction: challenge.transaction,
    });

    onStatusChange?.("verifying");
    return authApiClient.completeWalletAuth({
      kind: "transaction",
      challengeToken: challenge.challengeToken,
      signedTransaction,
    });
  })();

  inFlightProofs.set(inFlightKey, proof);

  try {
    return await proof;
  } finally {
    if (inFlightProofs.get(inFlightKey) === proof) {
      inFlightProofs.delete(inFlightKey);
    }
  }
}

export async function runWalletSiwsProofFlow({
  authApiClient,
  onStatusChange,
  signIn,
  turnstileToken,
  walletName,
}: {
  authApiClient: AuthApiClient;
  onStatusChange?: (status: WalletProofStatus) => void;
  signIn: WalletProofSignIn;
  turnstileToken?: string;
  walletName: string;
}): Promise<AuthSessionUser> {
  const inFlightKey = `siws:${walletName}`;
  const existingProof = inFlightProofs.get(inFlightKey);
  if (existingProof) {
    onStatusChange?.("awaiting_signature");
    return existingProof;
  }

  const proof = (async () => {
    const challenge = await authApiClient.challengeWalletAuth({
      kind: "siws",
      turnstileToken,
    });

    if (challenge.kind !== "siws") {
      throw new Error("The auth server returned an invalid SIWS challenge.");
    }

    onStatusChange?.("awaiting_signature");
    const output = await signWalletProofSignIn({
      signIn,
      signInInput: challenge.signInInput,
    });

    onStatusChange?.("verifying");
    return authApiClient.completeWalletAuth({
      kind: "siws",
      challengeToken: challenge.challengeToken,
      output,
    });
  })();

  inFlightProofs.set(inFlightKey, proof);

  try {
    return await proof;
  } finally {
    if (inFlightProofs.get(inFlightKey) === proof) {
      inFlightProofs.delete(inFlightKey);
    }
  }
}
