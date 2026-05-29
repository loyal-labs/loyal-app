"use client";

import {
  enumerateDepositsByUser,
  LoyalPrivateTransactionsClient,
  type WalletLike,
} from "@loyal-labs/private-transactions";
import { getPerEndpoints } from "@loyal-labs/solana-rpc";
import {
  createSolanaWalletDataClient,
  type SolanaWalletDataClient,
} from "@loyal-labs/solana-wallet";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection } from "@solana/web3.js";
import { useMemo } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { createFrontendAssetProvider } from "@/lib/solana/frontend-asset-provider";
import { getFrontendSolanaEndpoints } from "@/lib/solana/rpc-endpoints";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";

export function useSolanaWalletDataClient(): SolanaWalletDataClient {
  const publicEnv = usePublicEnv();
  const wallet = useWallet();

  return useMemo(() => {
    const { rpcEndpoint, websocketEndpoint } = getFrontendSolanaEndpoints(
      publicEnv.solanaEnv
    );
    const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(
      publicEnv.solanaEnv
    );

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
    let signedClientPromise: Promise<LoyalPrivateTransactionsClient> | null =
      null;

    const getSignedClient = () => {
      if (
        !wallet.publicKey ||
        !wallet.signTransaction ||
        !wallet.signAllTransactions ||
        !wallet.signMessage
      ) {
        return null;
      }

      signedClientPromise ??= LoyalPrivateTransactionsClient.fromConfig({
        signer: {
          publicKey: wallet.publicKey,
          signTransaction: wallet.signTransaction,
          signAllTransactions: wallet.signAllTransactions,
          signMessage: wallet.signMessage,
        } as unknown as WalletLike,
        baseRpcEndpoint: rpcEndpoint,
        baseWsEndpoint: websocketEndpoint,
        ephemeralRpcEndpoint: perRpcEndpoint,
        ephemeralWsEndpoint: perWsEndpoint,
      }).catch((error: unknown) => {
        signedClientPromise = null;
        throw error;
      });
      return signedClientPromise;
    };

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
        const enumerateDeposits = () =>
          enumerateDepositsByUser({
            user: owner,
            baseConnection,
            ephemeralConnection,
          });
        const signedClient = wallet.publicKey?.equals(owner)
          ? getSignedClient()
          : null;
        const deposits = signedClient
          ? await signedClient
              .then((client) => client.getAllDepositsByUser(owner))
              .catch((error: unknown) => {
                console.warn(
                  "Failed to load signed private deposits; falling back to public enumeration",
                  error
                );
                signedClientPromise = null;
                return enumerateDeposits();
              })
          : await enumerateDeposits();

        const secureBalances = new Map<string, bigint>();
        for (const deposit of deposits) {
          if (deposit.amount <= BigInt(0)) continue;
          secureBalances.set(deposit.tokenMint.toBase58(), deposit.amount);
        }
        return secureBalances;
      },
    });
  }, [
    publicEnv.solanaEnv,
    wallet.publicKey,
    wallet.signAllTransactions,
    wallet.signMessage,
    wallet.signTransaction,
  ]);
}
