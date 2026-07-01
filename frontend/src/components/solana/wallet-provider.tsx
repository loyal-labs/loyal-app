"use client";

import type { WalletName } from "@solana/wallet-adapter-base";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import type { FC, ReactNode } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";

type WalletConnectionProviderProps = {
  children: ReactNode;
};

type ExplicitWalletConnectIntent = {
  beginExplicitWalletConnect: (walletName: WalletName) => void;
  endExplicitWalletConnect: (walletName: WalletName | null) => void;
};

const ExplicitWalletConnectIntentContext =
  createContext<ExplicitWalletConnectIntent | null>(null);

export function useExplicitWalletConnectIntent() {
  const context = useContext(ExplicitWalletConnectIntentContext);
  if (!context) {
    throw new Error(
      "useExplicitWalletConnectIntent must be used within WalletConnectionProvider"
    );
  }
  return context;
}

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
  const explicitWalletConnectNameRef = useRef<WalletName | null>(null);
  const beginExplicitWalletConnect = useCallback((walletName: WalletName) => {
    explicitWalletConnectNameRef.current = walletName;
  }, []);
  const endExplicitWalletConnect = useCallback(
    (walletName: WalletName | null) => {
      if (!walletName) {
        return;
      }

      const activeWalletName = explicitWalletConnectNameRef.current;
      if (activeWalletName !== walletName) {
        return;
      }

      explicitWalletConnectNameRef.current = null;
    },
    []
  );
  const explicitWalletConnectIntent = useMemo(
    () => ({ beginExplicitWalletConnect, endExplicitWalletConnect }),
    [beginExplicitWalletConnect, endExplicitWalletConnect]
  );
  const shouldAutoConnect = useCallback(async () => {
    return explicitWalletConnectNameRef.current === null;
  }, []);

  return (
    <ConnectionProvider
      config={connectionConfig}
      endpoint={endpoint}
    >
      <WalletProvider autoConnect={shouldAutoConnect} wallets={wallets}>
        <ExplicitWalletConnectIntentContext.Provider
          value={explicitWalletConnectIntent}
        >
          {children}
        </ExplicitWalletConnectIntentContext.Provider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
