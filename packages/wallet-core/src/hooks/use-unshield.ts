import {
  LoyalPrivateTransactionsClient,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  type WalletLike,
} from "@loyal-labs/private-transactions";
import {
  type SolanaEnv,
  getPerEndpoints,
  getSolanaEndpoints,
} from "@loyal-labs/solana-rpc";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";

import type { WalletSigner } from "../types/signer";

// Exit-only path for the sunset private-transfer program (ASK-2269). Users
// still hold shielded balances on-chain; this lets them move funds back to
// their wallet. Shield / private send are intentionally not exposed.
//
// Runs against the deprecated npm tarball `@loyal-labs/private-transactions`
// 0.2.11 — the source lives in the private legacy repo. Do not add features.

export type ShieldedBalance = {
  tokenMint: string;
  /** Raw base-unit amount held in the deposit PDA. */
  amountRaw: bigint;
};

export type UnshieldResult = {
  signature?: string;
  success: boolean;
  error?: string;
};

function cleanSolanaErrorMessage(message: string): string {
  const logsIndex = message.indexOf("Logs:");
  return logsIndex === -1 ? message : message.slice(0, logsIndex).trim();
}

export function createPrivateTransactionsClient(
  signer: WalletSigner,
  solanaEnv: SolanaEnv
): Promise<LoyalPrivateTransactionsClient> {
  if (!signer.signMessage) {
    throw new Error("Wallet must support signMessage");
  }
  const { rpcEndpoint, websocketEndpoint } = getSolanaEndpoints(solanaEnv);
  const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(solanaEnv);
  const walletLike = {
    publicKey: signer.publicKey,
    signTransaction: signer.signTransaction.bind(signer),
    signAllTransactions: signer.signAllTransactions.bind(signer),
    signMessage: signer.signMessage.bind(signer),
  } as unknown as WalletLike;
  return LoyalPrivateTransactionsClient.fromConfig({
    signer: walletLike,
    baseRpcEndpoint: rpcEndpoint,
    baseWsEndpoint: websocketEndpoint,
    ephemeralRpcEndpoint: perRpcEndpoint,
    ephemeralWsEndpoint: perWsEndpoint,
  });
}

// Read-only: enumerates non-zero deposits so surfaces can gate the Unshield
// UI on `balances.length > 0`. Uses the base-layer program (no PER auth).
export async function fetchShieldedBalances(
  signer: WalletSigner,
  solanaEnv: SolanaEnv
): Promise<ShieldedBalance[]> {
  const client = await createPrivateTransactionsClient(signer, solanaEnv);
  const deposits = await client.getAllDepositsByUser(signer.publicKey);
  return deposits
    .filter((deposit) => deposit.amount > 0n)
    .map((deposit) => ({
      tokenMint: deposit.tokenMint.toBase58(),
      amountRaw: deposit.amount,
    }));
}

export function useUnshield(signer: WalletSigner | null, solanaEnv: SolanaEnv) {
  const [balances, setBalances] = useState<ShieldedBalance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<LoyalPrivateTransactionsClient | null>(null);
  const pubkey = signer?.publicKey.toBase58() ?? null;

  const getClient = useCallback(async () => {
    if (!signer) throw new Error("Wallet not connected");
    clientRef.current ??= await createPrivateTransactionsClient(
      signer,
      solanaEnv
    );
    return clientRef.current;
  }, [signer, solanaEnv]);

  const refreshBalances = useCallback(async () => {
    if (!signer) {
      setBalances([]);
      return;
    }
    try {
      setBalances(await fetchShieldedBalances(signer, solanaEnv));
    } catch {
      // Best-effort: a read failure must not hide the wallet.
      setBalances([]);
    }
  }, [signer, solanaEnv]);

  useEffect(() => {
    clientRef.current = null;
    void refreshBalances();
  }, [pubkey, refreshBalances]);

  // Always unshields the full deposit for `tokenMint`: exit-only, so partial
  // amounts and the Kamino share math they needed are gone.
  const executeUnshield = useCallback(
    async (tokenMint: string): Promise<UnshieldResult> => {
      if (!signer) {
        return { success: false, error: "Wallet not connected" };
      }
      setLoading(true);
      setError(null);
      try {
        const client = await getClient();
        const mint = new PublicKey(tokenMint);
        const user = signer.publicKey;
        const [ephemeral, base] = await Promise.all([
          client.getEphemeralDeposit(user, mint).catch(() => null),
          client.getBaseDeposit(user, mint).catch(() => null),
        ]);
        const amount = ephemeral?.amount ?? base?.amount ?? 0n;
        if (amount <= 0n) {
          throw new Error("No shielded balance for this token.");
        }
        const plan = await client.buildUnshieldTokensTransactionPlan({
          tokenMint: mint,
          amount,
          user,
          payer: user,
          magicProgram: MAGIC_PROGRAM_ID,
          magicContext: MAGIC_CONTEXT_ID,
        });
        const result = await client.executeUnshieldTokensTransactionPlan({
          plan,
        });
        await refreshBalances();
        return {
          success: true,
          signature: result.signatures[result.signatures.length - 1]?.signature,
        };
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message.includes("User rejected")
              ? "Transaction was rejected in your wallet."
              : cleanSolanaErrorMessage(err.message)
            : "Unshield failed";
        setError(message);
        return { success: false, error: message };
      } finally {
        setLoading(false);
      }
    },
    [signer, getClient, refreshBalances]
  );

  return { balances, refreshBalances, executeUnshield, loading, error };
}
