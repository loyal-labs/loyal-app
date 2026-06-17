import { enumerateDepositsByUser } from "@loyal-labs/private-transactions";
import {
  type SolanaEnv,
  getPerEndpoints,
  getSolanaEndpoints,
} from "@loyal-labs/solana-rpc";
import {
  createSolanaWalletDataClient,
  type SolanaWalletDataClient,
} from "@loyal-labs/solana-wallet";
import { Connection, type PublicKey } from "@solana/web3.js";
import { useMemo } from "react";

export function useSolanaWalletDataClient(
  solanaEnv: SolanaEnv,
  /** Used as cache-bust key so the client is recreated when the wallet changes */
  walletPublicKey: PublicKey | null
): SolanaWalletDataClient {
  return useMemo(() => {
    const { rpcEndpoint } = getSolanaEndpoints(solanaEnv);
    const { perRpcEndpoint } = getPerEndpoints(solanaEnv);
    const baseConnection = new Connection(rpcEndpoint, "confirmed");
    const ephemeralConnection = new Connection(perRpcEndpoint, "confirmed");

    return createSolanaWalletDataClient({
      env: solanaEnv,
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
  }, [solanaEnv, walletPublicKey]);
}
