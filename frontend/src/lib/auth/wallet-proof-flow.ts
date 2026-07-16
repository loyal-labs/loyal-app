"use client";

import type { AuthSessionUser } from "@loyal-labs/auth-core";

import type { AuthApiClient } from "@/lib/auth/client";
import type { LifecycleTracker } from "@/features/observability/lifecycle-contract";
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
  lifecycle?: LifecycleTracker;
};

const inFlightProofs = new Map<string, Promise<AuthSessionUser>>();

export async function runWalletMessageProofFlow({
  authApiClient,
  messageSigner,
  onStatusChange,
  turnstileToken,
  walletAddress,
  lifecycle,
}: WalletProofFlowArgs): Promise<AuthSessionUser> {
  const existingProof = inFlightProofs.get(walletAddress);
  if (existingProof) {
    onStatusChange?.("awaiting_signature");
    return existingProof;
  }

  const proof = (async () => {
    lifecycle?.observe("challenge", { authProofKind: "message" });
    const challenge = await authApiClient.challengeWalletAuth(
      {
        walletAddress,
        turnstileToken,
      },
      { flowId: lifecycle?.flowId }
    );

    if (challenge.kind === "siws" || challenge.kind === "transaction") {
      throw new Error("The auth server returned an invalid message challenge.");
    }

    onStatusChange?.("awaiting_signature");
    lifecycle?.observe("wallet_approval", { authProofKind: "message" });
    const signature = await signWalletProofMessage({
      signMessage: messageSigner,
      message: challenge.message,
    });

    onStatusChange?.("verifying");
    lifecycle?.observe("completion", { authProofKind: "message" });
    return authApiClient.completeWalletAuth(
      {
        challengeToken: challenge.challengeToken,
        signature,
      },
      { flowId: lifecycle?.flowId }
    );
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
  lifecycle,
}: {
  authApiClient: AuthApiClient;
  onStatusChange?: (status: WalletProofStatus) => void;
  signTransaction: WalletProofSignTransaction;
  turnstileToken?: string;
  walletAddress: string;
  lifecycle?: LifecycleTracker;
}): Promise<AuthSessionUser> {
  const inFlightKey = `transaction:${walletAddress}`;
  const existingProof = inFlightProofs.get(inFlightKey);
  if (existingProof) {
    onStatusChange?.("awaiting_signature");
    return existingProof;
  }

  const proof = (async () => {
    lifecycle?.observe("challenge", { authProofKind: "transaction" });
    const challenge = await authApiClient.challengeWalletAuth(
      {
        kind: "transaction",
        turnstileToken,
        walletAddress,
      },
      { flowId: lifecycle?.flowId }
    );

    if (challenge.kind !== "transaction") {
      throw new Error(
        "The auth server returned an invalid transaction challenge."
      );
    }

    onStatusChange?.("awaiting_signature");
    lifecycle?.observe("wallet_approval", { authProofKind: "transaction" });
    const signedTransaction = await signWalletProofTransaction({
      signTransaction,
      transaction: challenge.transaction,
    });

    onStatusChange?.("verifying");
    lifecycle?.observe("completion", { authProofKind: "transaction" });
    return authApiClient.completeWalletAuth(
      {
        kind: "transaction",
        challengeToken: challenge.challengeToken,
        signedTransaction,
      },
      { flowId: lifecycle?.flowId }
    );
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
  lifecycle,
}: {
  authApiClient: AuthApiClient;
  onStatusChange?: (status: WalletProofStatus) => void;
  signIn: WalletProofSignIn;
  turnstileToken?: string;
  walletName: string;
  lifecycle?: LifecycleTracker;
}): Promise<AuthSessionUser> {
  const inFlightKey = `siws:${walletName}`;
  const existingProof = inFlightProofs.get(inFlightKey);
  if (existingProof) {
    onStatusChange?.("awaiting_signature");
    return existingProof;
  }

  const proof = (async () => {
    lifecycle?.observe("challenge", { authProofKind: "siws" });
    const challenge = await authApiClient.challengeWalletAuth(
      {
        kind: "siws",
        turnstileToken,
      },
      { flowId: lifecycle?.flowId }
    );

    if (challenge.kind !== "siws") {
      throw new Error("The auth server returned an invalid SIWS challenge.");
    }

    onStatusChange?.("awaiting_signature");
    lifecycle?.observe("wallet_approval", { authProofKind: "siws" });
    const output = await signWalletProofSignIn({
      signIn,
      signInInput: challenge.signInInput,
    });

    onStatusChange?.("verifying");
    lifecycle?.observe("completion", { authProofKind: "siws" });
    return authApiClient.completeWalletAuth(
      {
        kind: "siws",
        challengeToken: challenge.challengeToken,
        output,
      },
      { flowId: lifecycle?.flowId }
    );
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
