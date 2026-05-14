"use client";

import { useWallet } from "@solana/wallet-adapter-react";

import { useAuthSession } from "@/contexts/auth-session-context";

export type AuthCapability =
  | "anonymous"
  | "authSession"
  | "walletConnected"
  | "authSessionAndWalletConnected";

export function resolveAuthCapability(args: {
  hasAuthSession: boolean;
  hasWalletConnection: boolean;
}): AuthCapability {
  if (args.hasAuthSession && args.hasWalletConnection) {
    return "authSessionAndWalletConnected";
  }

  if (args.hasAuthSession) {
    return "authSession";
  }

  if (args.hasWalletConnection) {
    return "walletConnected";
  }

  return "anonymous";
}

export function useAuthCapability() {
  const { connected } = useWallet();
  const { isAuthenticated, isHydrated, user } = useAuthSession();
  const capability = resolveAuthCapability({
    hasAuthSession: isAuthenticated,
    hasWalletConnection: connected,
  });

  return {
    capability,
    isHydrated,
    isSignedIn: capability !== "anonymous",
    hasAuthSession: isAuthenticated,
    hasWalletConnection: connected,
    hasWalletProofSession: user?.authMethod === "wallet",
  };
}
