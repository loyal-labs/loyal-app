"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import {
  toSolanaWalletConnectors,
  useStandardWallets,
} from "@privy-io/react-auth/solana";
import { registerWallet } from "@wallet-standard/wallet";
import { type ReactNode, useEffect } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";

// Spike (ASK-2262). Bridges Privy's embedded Solana wallet into the existing
// @solana/wallet-adapter tree by registering it as a Wallet Standard wallet,
// so every useWallet() consumer keeps working unchanged.
// ponytail: registers once per page load via module-level set; wallet-adapter
// dedupes by name, so a duplicate register is a no-op rather than a bug.
const registered = new Set<string>();

function PrivyEmbeddedWalletBridge() {
  const { ready, wallets } = useStandardWallets();
  useEffect(() => {
    if (!ready) return;
    for (const wallet of wallets) {
      if (!("isPrivyWallet" in wallet) || !wallet.isPrivyWallet) continue;
      if (registered.has(wallet.name)) continue;
      registered.add(wallet.name);
      registerWallet(wallet);
    }
  }, [ready, wallets]);
  return null;
}

export function PrivyAuthProvider({ children }: { children: ReactNode }) {
  const { privyAppId } = usePublicEnv();
  if (!privyAppId) return children;

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        // "google" goes back in once the dashboard has a Google OAuth client.
        loginMethods: ["email", "wallet"],
        appearance: {
          walletChainType: "solana-only",
          showWalletLoginFirst: true,
          // Only detected wallets: listing "phantom" explicitly as well made
          // Privy render it twice (duplicate React keys) when it is installed.
          walletList: ["detected_solana_wallets"],
        },
        // Spike: 'off' so wallet users get no embedded wallet; email/Google
        // users get one via useCreateWallet() in the modal (matches decision
        // "least friction, existing users keep their wallet").
        embeddedWallets: { solana: { createOnLogin: "off" } },
        externalWallets: {
          solana: { connectors: toSolanaWalletConnectors() },
        },
      }}
    >
      <PrivyEmbeddedWalletBridge />
      {children}
    </PrivyProvider>
  );
}
