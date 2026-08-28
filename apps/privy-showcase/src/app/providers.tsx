"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import type { ReactNode } from "react";
import { getPublicRpcUrl, getPublicWsUrl } from "@/lib/constants";

export function Providers({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
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
              rpc: createSolanaRpc(getPublicRpcUrl()),
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
