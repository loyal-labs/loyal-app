"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { type ReactNode, useEffect } from "react";
import { getPublicRpcUrl, getPublicWsUrl } from "@/lib/constants";

export function Providers({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  useEffect(() => {
    // Wallet browser extensions that fight over EVM provider injection can
    // recurse when Privy probes accounts. That crash is theirs, not ours;
    // keep it from taking over the page (and the dev overlay), whether it
    // surfaces as an error event or an unhandled promise rejection.
    const isExtensionRecursion = (candidate: unknown) => {
      const error = candidate as Error | undefined;
      return (
        typeof error?.message === "string" &&
        error.message.includes("Maximum call stack size exceeded") &&
        typeof error.stack === "string" &&
        error.stack.includes("chrome-extension://")
      );
    };
    const swallowError = (event: ErrorEvent) => {
      if (isExtensionRecursion(event.error)) event.preventDefault();
    };
    const swallowRejection = (event: PromiseRejectionEvent) => {
      if (isExtensionRecursion(event.reason)) event.preventDefault();
    };
    window.addEventListener("error", swallowError);
    window.addEventListener("unhandledrejection", swallowRejection);
    return () => {
      window.removeEventListener("error", swallowError);
      window.removeEventListener("unhandledrejection", swallowRejection);
    };
  }, []);
  if (!appId) {
    return (
      <main>
        <section className="hero">
          <div className="shell">
            <header className="hero-grid">
              <div>
                <span className="eyebrow">Loyal × Privy</span>
                <h1>Configuration required</h1>
                <p className="lede">
                  Mount <code>NEXT_PUBLIC_PRIVY_APP_ID</code> through 1Password,
                  then restart the demo. No credential should be written to a
                  tracked env file.
                </p>
              </div>
            </header>
          </div>
        </section>
      </main>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        appearance: {
          walletChainType: "ethereum-and-solana",
          showWalletLoginFirst: false,
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" },
          solana: { createOnLogin: "all-users" },
        },
        solana: {
          rpcs: {
            "solana:mainnet": {
              rpc: createSolanaRpc(
                typeof window === "undefined"
                  ? getPublicRpcUrl()
                  : new URL("/api/rpc", window.location.origin).toString()
              ),
              rpcSubscriptions: createSolanaRpcSubscriptions(getPublicWsUrl()),
            },
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
