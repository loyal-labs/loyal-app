import {
  enumerateDepositsByUser,
  LoyalPrivateTransactionsClient,
  type WalletLike,
} from "@loyal-labs/private-transactions";
import {
  createSolanaWalletDataClient,
  type SecureBalanceMap,
  type SolanaWalletDataClient,
} from "@loyal-labs/solana-wallet";
import { getPerEndpoints, getSolanaEndpoints } from "@loyal-labs/solana-rpc";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { Connection } from "@solana/web3.js";
import { useMemo } from "react";

import type { WalletSigner } from "@loyal-labs/wallet-core/types";

export function useExtensionWalletDataClient(
  solanaEnv: SolanaEnv,
  signer: WalletSigner | null
): SolanaWalletDataClient {
  return useMemo(() => {
    const { rpcEndpoint, websocketEndpoint } = getSolanaEndpoints(solanaEnv);
    const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(solanaEnv);
    const baseConnection = new Connection(rpcEndpoint, "confirmed");
    const ephemeralConnection = new Connection(perRpcEndpoint, "confirmed");
    let signedClientPromise: Promise<LoyalPrivateTransactionsClient> | null =
      null;

    const getSignedClient = () => {
      if (!signer || !signer.signMessage) return null;
      signedClientPromise ??= LoyalPrivateTransactionsClient.fromConfig({
        signer: signer as unknown as WalletLike,
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
      env: solanaEnv,
      secureBalanceProvider: async ({ owner }) => {
        const enumerateDeposits = () =>
          enumerateDepositsByUser({
            user: owner,
            baseConnection,
            ephemeralConnection,
          });
        const signedClient = getSignedClient();
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
        return secureBalances as SecureBalanceMap;
      },
    });
  }, [solanaEnv, signer]);
}
