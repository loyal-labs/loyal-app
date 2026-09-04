"use client";

import {
  createSolanaWalletDataClient,
  type CreateSolanaWalletDataClientConfig,
  type SolanaWalletDataClient,
} from "@loyal-labs/solana-wallet";
import { Connection } from "@solana/web3.js";
import { useMemo } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { createFrontendAssetProvider } from "@/lib/solana/frontend-asset-provider";
import { getFrontendSolanaEndpoints } from "@/lib/solana/rpc-endpoints";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";

export function useSolanaWalletDataClient(): SolanaWalletDataClient {
  const publicEnv = usePublicEnv();

  return useMemo(() => {
    const { rpcEndpoint, websocketEndpoint } = getFrontendSolanaEndpoints(
      publicEnv.solanaEnv
    );

    const clientConfig: CreateSolanaWalletDataClientConfig = {
      assetProvider: createFrontendAssetProvider({
        commitment: "confirmed",
        fetchImpl: globalThis.fetch,
        rpcEndpoint,
        solanaEnv: publicEnv.solanaEnv,
        websocketEndpoint,
      }),
      env: publicEnv.solanaEnv,
      createRpcConnection: (endpoint, commitment) =>
        new Connection(endpoint, {
          commitment,
          disableRetryOnRateLimit: true,
          fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
        }),
      createWebsocketConnection: (endpoint, websocketEndpoint, commitment) =>
        new Connection(endpoint, {
          commitment,
          disableRetryOnRateLimit: true,
          fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
          wsEndpoint: websocketEndpoint,
      }),
      rpcEndpoint,
      websocketEndpoint,
    };

    return createSolanaWalletDataClient(clientConfig);
  }, [publicEnv.solanaEnv]);
}
