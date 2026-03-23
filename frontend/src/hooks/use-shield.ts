import {
  DELEGATION_PROGRAM_ID,
  findDepositPda,
  getErValidatorForSolanaEnv,
  LoyalPrivateTransactionsClient,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@loyal-labs/private-transactions";
import type { AnalyticsProperties } from "@loyal-labs/shared/analytics";
import { getPerEndpoints, getSolanaEndpoints } from "@loyal-labs/solana-rpc";
import { TOKEN_DECIMALS, TOKEN_MINTS } from "@loyal-labs/wallet-core/constants";
import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useRef, useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { trackWalletShieldCompleted } from "@/lib/core/analytics";
import { closeWsolAta, wrapSolToWSol } from "@/lib/solana/wsol-adapter";

export type ShieldResult = {
  signature?: string;
  success: boolean;
  error?: string;
};

async function waitForAccount(
  connection: ReturnType<typeof useConnection>["connection"],
  pda: PublicKey,
  maxAttempts = 30,
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const info = await connection.getAccountInfo(pda);
    if (info) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

export function useShield() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const publicEnv = usePublicEnv();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<LoyalPrivateTransactionsClient | null>(null);

  const getClient = useCallback(async (): Promise<LoyalPrivateTransactionsClient> => {
    if (clientRef.current) return clientRef.current;

    if (
      !wallet.publicKey ||
      !wallet.signTransaction ||
      !wallet.signAllTransactions ||
      !wallet.signMessage
    ) {
      throw new Error("Wallet must support signTransaction, signAllTransactions, and signMessage");
    }

    const { rpcEndpoint, websocketEndpoint } = getSolanaEndpoints(publicEnv.solanaEnv);
    const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(publicEnv.solanaEnv);

    const signer = {
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction,
      signAllTransactions: wallet.signAllTransactions,
      signMessage: wallet.signMessage,
    } as unknown as import("@loyal-labs/private-transactions").WalletLike;

    const client = await LoyalPrivateTransactionsClient.fromConfig({
      signer,
      baseRpcEndpoint: rpcEndpoint,
      baseWsEndpoint: websocketEndpoint,
      ephemeralRpcEndpoint: perRpcEndpoint,
      ephemeralWsEndpoint: perWsEndpoint,
    });

    clientRef.current = client;
    return client;
  }, [wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions, wallet.signMessage, publicEnv.solanaEnv]);

  // Reset client when wallet changes
  const prevPubkey = useRef(wallet.publicKey?.toBase58());
  if (wallet.publicKey?.toBase58() !== prevPubkey.current) {
    clientRef.current = null;
    prevPubkey.current = wallet.publicKey?.toBase58();
  }

  const executeShield = useCallback(
    async (params: {
      tokenSymbol: string;
      amount: number;
      tokenMint?: string;
      successTrackingProperties?: AnalyticsProperties;
    }): Promise<ShieldResult> => {
      if (!(wallet.connected && wallet.publicKey && wallet.signTransaction)) {
        return { success: false, error: "Wallet not connected or missing signing capability" };
      }

      setLoading(true);
      setError(null);

      try {
        const client = await getClient();
        const resolvedMint = params.tokenMint || TOKEN_MINTS[params.tokenSymbol.toUpperCase()];
        if (!resolvedMint) {
          throw new Error(`Unknown token: ${params.tokenSymbol}`);
        }
        const tokenMint = new PublicKey(resolvedMint);
        const decimals = TOKEN_DECIMALS[params.tokenSymbol.toUpperCase()] ?? 6;
        const rawAmount = Math.floor(params.amount * 10 ** decimals);
        const user = wallet.publicKey;
        const validator = getErValidatorForSolanaEnv(publicEnv.solanaEnv);
        const isNativeSol = tokenMint.equals(NATIVE_MINT);

        // Init deposit if needed
        const baseDeposit = await client.getBaseDeposit(user, tokenMint);
        if (!baseDeposit) {
          await client.initializeDeposit({ tokenMint, user, payer: user });
          const [depositPda] = findDepositPda(user, tokenMint);
          await waitForAccount(connection, depositPda);
        }

        // Wrap SOL → wSOL if native
        const walletSigner = {
          publicKey: user,
          signTransaction: wallet.signTransaction,
        };
        let createdAta = false;
        if (isNativeSol) {
          const result = await wrapSolToWSol({ connection, wallet: walletSigner, lamports: rawAmount });
          createdAta = result.createdAta;
        }

        const userTokenAccount = getAssociatedTokenAddressSync(tokenMint, user, false, TOKEN_PROGRAM_ID);

        // Undelegate if currently delegated
        const [depositPda] = findDepositPda(user, tokenMint);
        const depositInfo = await connection.getAccountInfo(depositPda);
        if (depositInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
          await client.undelegateDeposit({
            tokenMint,
            user,
            payer: user,
            magicProgram: MAGIC_PROGRAM_ID,
            magicContext: MAGIC_CONTEXT_ID,
          });
        }

        // Move tokens into deposit vault (increase balance)
        await client.modifyBalance({
          tokenMint,
          amount: rawAmount,
          increase: true,
          user,
          payer: user,
          userTokenAccount,
        });

        // Close wSOL ATA if we created it
        if (isNativeSol && createdAta) {
          await closeWsolAta({ connection, wallet: walletSigner, wsolAta: userTokenAccount });
        }

        // Create permission (may already exist)
        try {
          await client.createPermission({ tokenMint, user, payer: user });
        } catch {
          // Permission may already exist
        }

        // Delegate deposit
        try {
          await client.delegateDeposit({ tokenMint, user, payer: user, validator });
        } catch {
          // May already be delegated
        }

        setLoading(false);
        if (params.successTrackingProperties) {
          trackWalletShieldCompleted(publicEnv, params.successTrackingProperties);
        }
        return { success: true };
      } catch (err) {
        let errorMessage = "Shield failed";
        if (err instanceof Error) {
          errorMessage = err.message.includes("User rejected")
            ? "Transaction was rejected in your wallet."
            : err.message;
        }
        setError(errorMessage);
        setLoading(false);
        return { success: false, error: errorMessage };
      }
    },
    [wallet.connected, wallet.publicKey, wallet.signTransaction, connection, getClient, publicEnv],
  );

  const executeUnshield = useCallback(
    async (params: {
      tokenSymbol: string;
      amount: number;
      tokenMint?: string;
    }): Promise<ShieldResult> => {
      if (!(wallet.connected && wallet.publicKey && wallet.signTransaction)) {
        return { success: false, error: "Wallet not connected or missing signing capability" };
      }

      setLoading(true);
      setError(null);

      try {
        const client = await getClient();
        const resolvedMint = params.tokenMint || TOKEN_MINTS[params.tokenSymbol.toUpperCase()];
        if (!resolvedMint) {
          throw new Error(`Unknown token: ${params.tokenSymbol}`);
        }
        const tokenMint = new PublicKey(resolvedMint);
        const decimals = TOKEN_DECIMALS[params.tokenSymbol.toUpperCase()] ?? 6;
        const rawAmount = Math.floor(params.amount * 10 ** decimals);
        const user = wallet.publicKey;
        const isNativeSol = tokenMint.equals(NATIVE_MINT);

        const userTokenAccount = getAssociatedTokenAddressSync(tokenMint, user, false, TOKEN_PROGRAM_ID);

        // Undelegate if currently delegated
        const [depositPda] = findDepositPda(user, tokenMint);
        const depositInfo = await connection.getAccountInfo(depositPda);
        if (depositInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
          await client.undelegateDeposit({
            tokenMint,
            user,
            payer: user,
            magicProgram: MAGIC_PROGRAM_ID,
            magicContext: MAGIC_CONTEXT_ID,
          });
        }

        // Move tokens out of deposit vault (decrease balance)
        await client.modifyBalance({
          tokenMint,
          amount: rawAmount,
          increase: false,
          user,
          payer: user,
          userTokenAccount,
        });

        // Unwrap wSOL if native SOL
        if (isNativeSol) {
          const walletSigner = {
            publicKey: user,
            signTransaction: wallet.signTransaction,
          };
          await closeWsolAta({ connection, wallet: walletSigner, wsolAta: userTokenAccount });
        }

        // Re-delegate deposit
        try {
          const validator = getErValidatorForSolanaEnv(publicEnv.solanaEnv);
          await client.delegateDeposit({ tokenMint, user, payer: user, validator });
        } catch {
          // May already be delegated or deposit empty
        }

        setLoading(false);
        return { success: true };
      } catch (err) {
        let errorMessage = "Unshield failed";
        if (err instanceof Error) {
          errorMessage = err.message.includes("User rejected")
            ? "Transaction was rejected in your wallet."
            : err.message;
        }
        setError(errorMessage);
        setLoading(false);
        return { success: false, error: errorMessage };
      }
    },
    [wallet.connected, wallet.publicKey, wallet.signTransaction, connection, getClient, publicEnv],
  );

  return {
    executeShield,
    executeUnshield,
    loading,
    error,
  };
}
