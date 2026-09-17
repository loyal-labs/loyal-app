"use client";

import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import type { ConnectionConfig } from "@solana/web3.js";
import type { ReactNode } from "react";

const wallets: [] = [];
const connectionConfig: ConnectionConfig = {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
  fetchMiddleware: (input, init, next) => next(input, { ...init,
    signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  }),
};
export function DemoWalletProvider({ children }: { children: ReactNode }) {
  return (
    <ConnectionProvider
      endpoint="https://solana-rpc.publicnode.com"
      config={connectionConfig}
    >
      <WalletProvider
        wallets={wallets}
        autoConnect={false}
        localStorageKey="loyal-vault-demo:wallet-name"
      >
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
