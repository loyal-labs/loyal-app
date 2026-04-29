"use client";

import { WalletAdapterNetwork, type Adapter } from "@solana/wallet-adapter-base";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletConnectWalletAdapter } from "@walletconnect/solana-adapter";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import type { FC, ReactNode } from "react";
import { useCallback, useMemo } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";

import {
  DEV_KEYPAIR_WALLET_NAME,
  DevKeypairWalletAdapter,
} from "./dev-keypair-wallet";

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

  const wallets = useMemo(
    () => [
      new WalletConnectWalletAdapter({
        network: toWalletConnectNetwork(solanaEnv),
        options: {
          projectId: WALLETCONNECT_PROJECT_ID,
        },
      }),
      ...(publicEnv.appEnvironment === "local"
        ? [new DevKeypairWalletAdapter()]
        : []),
    ],
    [publicEnv.appEnvironment, solanaEnv]
  );

  const shouldAutoConnect = useCallback(
    async (adapter: Adapter) => adapter.name !== DEV_KEYPAIR_WALLET_NAME,
    []
  );

  return (
    <ConnectionProvider
      config={{ commitment: "confirmed", confirmTransactionInitialTimeout: 60_000 }}
      endpoint={endpoint}
    >
      <WalletProvider autoConnect={shouldAutoConnect} wallets={wallets}>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
};
