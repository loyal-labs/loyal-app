import {
  createSolanaWalletDataClient,
  type SolanaWalletDataClient,
} from "@loyal-labs/solana-wallet";
import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import { useMemo } from "react";

export function useExtensionWalletDataClient(
  solanaEnv: SolanaEnv
): SolanaWalletDataClient {
  return useMemo(() => {
    return createSolanaWalletDataClient({ env: solanaEnv });
  }, [solanaEnv]);
}
