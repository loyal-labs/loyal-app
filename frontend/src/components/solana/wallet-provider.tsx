"use client";

import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import type { FC, ReactNode } from "react";
import { useMemo } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";

type WalletConnectionProviderProps = {
  children: ReactNode;
};

export const WalletConnectionProvider: FC<WalletConnectionProviderProps> = ({
  children,
}) => {
  const publicEnv = usePublicEnv();
  const { solanaRpcEndpoint } = publicEnv;
  const endpoint = useMemo(() => solanaRpcEndpoint, [solanaRpcEndpoint]);
  const rpcFetch = useMemo(
    () => getFrontendSolanaRpcFetch(globalThis.fetch),
    []
  );
  const connectionConfig = useMemo(
    () => ({
      commitment: "confirmed" as const,
      confirmTransactionInitialTimeout: 60_000,
      disableRetryOnRateLimit: true,
      fetch: rpcFetch,
    }),
    [rpcFetch]
  );

  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider
      config={connectionConfig}
      endpoint={endpoint}
    >
      <WalletProvider autoConnect wallets={wallets}>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
};
