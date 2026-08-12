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
        <header>
          <div>
            <span className="eyebrow">PRIVY × LOYAL</span>
            <h1>Configuration required.</h1>
          </div>
          <div className="network">
            <i /> Solana mainnet-beta
          </div>
        </header>
        <p className="lede">
          Mount <code>NEXT_PUBLIC_PRIVY_APP_ID</code> through 1Password, then
          restart the demo. No credential should be written to a tracked env
          file.
        </p>
      </main>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        appearance: {
          walletChainType: "solana-only",
          showWalletLoginFirst: false,
        },
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
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
