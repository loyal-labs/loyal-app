"use client";

import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletConnectWalletAdapter } from "@walletconnect/solana-adapter";
import type { FC, ReactNode } from "react";
import { useMemo } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";

const WALLETCONNECT_PROJECT_ID = "9d9f57c5553496b42ac1b9977066559d";

function toWalletConnectNetwork(
  env: SolanaEnv
): WalletAdapterNetwork.Mainnet | WalletAdapterNetwork.Devnet {
  return env === "mainnet"
    ? WalletAdapterNetwork.Mainnet
    : WalletAdapterNetwork.Devnet;
}

type WalletConnectionProviderProps = {
  children: ReactNode;
};

export const WalletConnectionProvider: FC<WalletConnectionProviderProps> = ({
  children,
}) => {
  const publicEnv = usePublicEnv();
  const { solanaRpcEndpoint, solanaEnv } = publicEnv;
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

  const wallets = useMemo(
    () => [
      new WalletConnectWalletAdapter({
        network: toWalletConnectNetwork(solanaEnv),
        options: {
          projectId: WALLETCONNECT_PROJECT_ID,
        },
      }),
    ],
    [solanaEnv]
  );

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
