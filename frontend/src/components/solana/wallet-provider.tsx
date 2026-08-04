"use client";

import type { Adapter, WalletName } from "@solana/wallet-adapter-base";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from "@solana/wallet-adapter-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FC, ReactNode } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { useCherryRuntime } from "@/features/cherry/client/runtime-context";
import { isVerifiedCherryWalletMatch } from "@/features/cherry/client/runtime-contract";
import { CherryStatusScreen } from "@/features/cherry/client/status-screen";
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

const CHERRY_WALLET_NAME = "Cherry" as WalletName;
const CHERRY_WALLET_STORAGE_KEY = "loyal:cherry-wallet";
const CHERRY_CONNECT_FEEDBACK_TIMEOUT_MS = 10_000;

function CherryWalletGate({ children }: { children: ReactNode }) {
  const runtime = useCherryRuntime();
  const {
    connect,
    connected,
    connecting,
    disconnect,
    publicKey,
    select,
    wallet,
  } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const terminalErrorRef = useRef(false);
  const fail = useCallback((message: string) => {
    terminalErrorRef.current = true;
    setError(message);
  }, []);

  useEffect(() => {
    if (runtime.mode !== "cherry_mobile" || terminalErrorRef.current) {
      return;
    }

    if (wallet?.adapter.name !== CHERRY_WALLET_NAME) {
      select(CHERRY_WALLET_NAME);
      return;
    }

    if (!(connected || connecting)) {
      void connect().catch(() => {
        fail("Cherry could not connect this wallet. Reopen the Mini App.");
      });
    }
  }, [connect, connected, connecting, fail, runtime.mode, select, wallet]);

  useEffect(() => {
    if (runtime.mode !== "cherry_mobile" || connected) {
      return;
    }

    const timeout = window.setTimeout(() => {
      fail("Cherry did not respond. Reopen the Mini App and try again.");
    }, CHERRY_CONNECT_FEEDBACK_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [connected, fail, runtime.mode]);

  useEffect(() => {
    if (
      runtime.mode !== "cherry_mobile" ||
      !connected ||
      isVerifiedCherryWalletMatch(
        runtime.verifiedWalletAddress,
        publicKey?.toBase58() ?? null
      )
    ) {
      return;
    }

    fail("The connected Cherry wallet does not match this launch.");
    void disconnect().catch(() => undefined);
  }, [connected, disconnect, fail, publicKey, runtime]);

  if (runtime.mode !== "cherry_mobile") {
    return children;
  }

  if (error) {
    return <CherryStatusScreen message={error} role="alert" />;
  }

  if (
    !connected ||
    !isVerifiedCherryWalletMatch(
      runtime.verifiedWalletAddress,
      publicKey?.toBase58() ?? null
    )
  ) {
    return <CherryStatusScreen message="Connecting your Cherry wallet…" />;
  }

  return children;
}

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
  const cherryRuntime = useCherryRuntime();
  const cherryOperationLease =
    cherryRuntime.mode === "cherry_mobile"
      ? cherryRuntime.operationLease
      : null;
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

  const [cherryAdapter, setCherryAdapter] = useState<Adapter | null>(null);
  const [cherryAdapterLoadFailed, setCherryAdapterLoadFailed] = useState(false);
  useEffect(() => {
    if (!cherryOperationLease) {
      setCherryAdapter(null);
      setCherryAdapterLoadFailed(false);
      return;
    }

    setCherryAdapterLoadFailed(false);
    let cancelled = false;
    let adapter: Adapter | null = null;
    void import("@/features/cherry/client/wallet-adapter")
      .then((module) =>
        module.createLoyalCherryWalletAdapter(cherryOperationLease)
      )
      .then((loadedAdapter) => {
        if (cancelled) {
          void loadedAdapter.disconnect().catch(() => undefined);
          return;
        }
        adapter = loadedAdapter;
        setCherryAdapter(adapter);
      })
      .catch(() => {
        if (!cancelled) {
          setCherryAdapterLoadFailed(true);
        }
      });

    return () => {
      cancelled = true;
      if (adapter) {
        void adapter.disconnect().catch(() => undefined);
      }
    };
  }, [cherryOperationLease]);
  const wallets = useMemo(
    () => (cherryAdapter ? [cherryAdapter] : []),
    [cherryAdapter]
  );
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

  if (cherryRuntime.mode === "cherry_mobile" && cherryAdapterLoadFailed) {
    return (
      <CherryStatusScreen
        message="The Cherry wallet is unavailable. Reopen the Mini App."
        role="alert"
      />
    );
  }

  if (cherryRuntime.mode === "cherry_mobile" && !cherryAdapter) {
    return <CherryStatusScreen message="Preparing the Cherry wallet…" />;
  }

  return (
    <ConnectionProvider config={connectionConfig} endpoint={endpoint}>
      <WalletProvider
        autoConnect={
          cherryRuntime.mode === "cherry_mobile" ? false : shouldAutoConnect
        }
        localStorageKey={
          cherryRuntime.mode === "cherry_mobile"
            ? CHERRY_WALLET_STORAGE_KEY
            : "walletName"
        }
        wallets={wallets}
      >
        <ExplicitWalletConnectIntentContext.Provider
          value={explicitWalletConnectIntent}
        >
          <CherryWalletGate>{children}</CherryWalletGate>
        </ExplicitWalletConnectIntentContext.Provider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
