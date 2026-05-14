"use client";

import type { AuthSessionUser } from "@loyal-labs/auth-core";

import type { AuthApiClient } from "@/lib/auth/client";
import {
  type WalletProofSignMessage,
  signWalletProofMessage,
} from "@/lib/auth/wallet-proof-signer";

type WalletProofStatus = "awaiting_signature" | "verifying";

type WalletProofFlowArgs = {
  authApiClient: AuthApiClient;
  messageSigner: WalletProofSignMessage | undefined;
  onStatusChange?: (status: WalletProofStatus) => void;
  walletAddress: string;
};

const inFlightProofs = new Map<string, Promise<AuthSessionUser>>();

export async function runWalletProofFlow({
  authApiClient,
  messageSigner,
  onStatusChange,
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
    });

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
