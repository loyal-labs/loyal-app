"use client";

import { enumerateDepositsByUser } from "@loyal-labs/private-transactions";
import { getPerEndpoints } from "@loyal-labs/solana-rpc";
import {
  createSolanaWalletDataClient,
  type CreateSolanaWalletDataClientConfig,
  type SolanaWalletDataClient,
} from "@loyal-labs/solana-wallet";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection } from "@solana/web3.js";
import { useMemo } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { createFrontendAssetProvider } from "@/lib/solana/frontend-asset-provider";
import {
  getFrontendPrivateClient,
  invalidateFrontendPrivateClient,
  invalidateFrontendPrivateClientForError,
  type FrontendPrivateClientSigner,
} from "@/lib/solana/private-client-cache";
import { getFrontendSolanaEndpoints } from "@/lib/solana/rpc-endpoints";
import { getFrontendSolanaRpcFetch } from "@/lib/solana/rpc-rate-limit";

type UseSolanaWalletDataClientOptions = {
  includeSecureBalances?: boolean;
};

export function useSolanaWalletDataClient(
  options: UseSolanaWalletDataClientOptions = {}
): SolanaWalletDataClient {
  const publicEnv = usePublicEnv();
  const wallet = useWallet();
  const includeSecureBalances = options.includeSecureBalances === true;

  return useMemo(() => {
    const { rpcEndpoint, websocketEndpoint } = getFrontendSolanaEndpoints(
      publicEnv.solanaEnv
    );

    const clientConfig: CreateSolanaWalletDataClientConfig = {
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
    };

    if (includeSecureBalances) {
      let baseConnection: Connection | null = null;
      let ephemeralConnection: Connection | null = null;
      const getBaseConnection = () => {
        baseConnection ??= new Connection(rpcEndpoint, {
          commitment: "confirmed",
          disableRetryOnRateLimit: true,
          fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
        });
        return baseConnection;
      };
      const getEphemeralConnection = () => {
        if (!ephemeralConnection) {
          const { perRpcEndpoint } = getPerEndpoints(publicEnv.solanaEnv);
          ephemeralConnection = new Connection(perRpcEndpoint, {
            commitment: "confirmed",
            disableRetryOnRateLimit: true,
            fetch: getFrontendSolanaRpcFetch(globalThis.fetch),
          });
        }
        return ephemeralConnection;
      };
      const getSignedClient = () => {
        if (
          !wallet.publicKey ||
          !wallet.signTransaction ||
          !wallet.signAllTransactions ||
          !wallet.signMessage
        ) {
          return null;
        }

        return getFrontendPrivateClient({
          signer: {
            publicKey: wallet.publicKey,
            signTransaction: wallet.signTransaction,
            signAllTransactions: wallet.signAllTransactions,
            signMessage: wallet.signMessage,
          } as FrontendPrivateClientSigner,
          solanaEnv: publicEnv.solanaEnv,
        });
      };

      clientConfig.secureBalanceProvider = async ({ owner }) => {
        const enumerateDeposits = () =>
          enumerateDepositsByUser({
            user: owner,
            baseConnection: getBaseConnection(),
            ephemeralConnection: getEphemeralConnection(),
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
                const invalidatedAuth = invalidateFrontendPrivateClientForError(
                  {
                    publicKey: owner.toBase58(),
                    solanaEnv: publicEnv.solanaEnv,
                    error,
                  }
                );
                if (!invalidatedAuth) {
                  invalidateFrontendPrivateClient({
                    publicKey: owner.toBase58(),
                    solanaEnv: publicEnv.solanaEnv,
                  });
                }
                return enumerateDeposits();
              })
          : await enumerateDeposits();

        const secureBalances = new Map<string, bigint>();
        for (const deposit of deposits) {
          if (deposit.amount <= BigInt(0)) continue;
          secureBalances.set(deposit.tokenMint.toBase58(), deposit.amount);
        }
        return secureBalances;
      };
    }

    return createSolanaWalletDataClient(clientConfig);
  }, [
    includeSecureBalances,
    publicEnv.solanaEnv,
    wallet.publicKey,
    wallet.signAllTransactions,
    wallet.signMessage,
    wallet.signTransaction,
  ]);
}
