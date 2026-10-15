"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import {
  toSolanaWalletConnectors,
  useStandardWallets,
} from "@privy-io/react-auth/solana";
import { registerWallet } from "@wallet-standard/wallet";
import { type ReactNode, useEffect, useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";

// Loyal brand: Background/Primary + Background/Accent from globals.css.
const LOYAL_THEME = {
  light: { theme: "#FFFFFF", accentColor: "#F9363C" },
  dark: { theme: "#1D1B20", accentColor: "#FF5050" },
} as const;

// Follows html.dark, which use-theme.ts toggles. Privy rebuilds its palette
// whenever the config prop changes, so this is all the modal needs.
function usePrivyTheme() {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark ? LOYAL_THEME.dark : LOYAL_THEME.light;
}

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

// Privy SDK noise we cannot fix: dev-only React warnings inside Privy's own
// modal, and a stray iframe reply after HMR remounts the provider ("cannot
// dequeue privy:... event"). Swallow only those, only in the browser.
function installPrivyNoiseFilter() {
  if (typeof window === "undefined") return;
  const w = window as Window & { __privyNoiseFilter__?: true };
  if (w.__privyNoiseFilter__) return;
  w.__privyNoiseFilter__ = true;

  const isPrivyNoise = (message: unknown) =>
    typeof message === "string" &&
    (message.startsWith("cannot dequeue privy:") ||
      (process.env.NODE_ENV !== "production" &&
        ((message.includes('unique "key" prop') &&
          message.includes("from xe")) ||
          (message.includes("Updating a style property during rerender") &&
            message.includes("backgroundSize")))));

  window.addEventListener(
    "unhandledrejection",
    (event) => {
      const reason = event.reason as { message?: unknown } | undefined;
      if (isPrivyNoise(reason?.message)) event.preventDefault();
    },
    true
  );
  window.addEventListener(
    "error",
    (event) => {
      if (isPrivyNoise(event.message)) event.preventDefault();
    },
    true
  );
  if (process.env.NODE_ENV !== "production") {
    const original = console.error;
    console.error = (...args: unknown[]) => {
      const text = args.map((a) => (typeof a === "string" ? a : "")).join(" ");
      if (isPrivyNoise(text)) return;
      original(...args);
    };
  }
}

export function PrivyAuthProvider({ children }: { children: ReactNode }) {
  const { privyAppId } = usePublicEnv();
  const theme = usePrivyTheme();
  useEffect(installPrivyNoiseFilter, []);
  if (!privyAppId) return children;

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ["email", "google", "wallet"],
        appearance: {
          ...theme,
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
