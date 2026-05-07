"use client";

import { enumerateDepositsByUser } from "@loyal-labs/private-transactions";
import { getPerEndpoints } from "@loyal-labs/solana-rpc";
import {
  createSolanaWalletDataClient,
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
    const { perRpcEndpoint } = getPerEndpoints(publicEnv.solanaEnv);

    const baseConnection = new Connection(rpcEndpoint, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
      fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    });
    const ephemeralConnection = new Connection(perRpcEndpoint, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
      fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
    });

    return createSolanaWalletDataClient({
      assetProvider: createFrontendAssetProvider({
        commitment: "confirmed",
        fetchImpl: globalThis.fetch,
        rpcEndpoint,
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
      secureBalanceProvider: async ({ owner }) => {
        const deposits = await enumerateDepositsByUser({
          user: owner,
          baseConnection,
          ephemeralConnection,
        });

        const secureBalances = new Map<string, bigint>();
        for (const deposit of deposits) {
          if (deposit.amount <= BigInt(0)) continue;
          secureBalances.set(deposit.tokenMint.toBase58(), deposit.amount);
        }
        return secureBalances;
      },
    });
  }, [publicEnv.solanaEnv]);
}
