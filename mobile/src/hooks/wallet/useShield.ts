import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useRef, useState } from "react";

import {
  getConnection,
  getEndpoints,
  getPerEndpoints,
  getSolanaEnv,
} from "@/lib/solana/rpc/connection";
// Lazy-loaded alongside the SDK to avoid top-level Buffer usage
async function getWsolAdapter() {
  return await import("@/lib/solana/wsol-adapter");
}
import { useWallet } from "@/lib/wallet/wallet-provider";

// Lazy-loaded to avoid top-level Buffer usage from the private-transactions SDK
async function getPrivateTransactions() {
  return await import("@loyal-labs/private-transactions");
}
async function getSplToken() {
  return await import("@solana/spl-token");
}

const TOKEN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
};

const TOKEN_DECIMALS: Record<string, number> = {
  SOL: 9,
  USDC: 6,
  USDT: 6,
  BONK: 5,
};

export type ShieldResult = {
  signature?: string;
  success: boolean;
  error?: string;
};

async function waitForAccount(
  connection: Connection,
  pda: PublicKey,
  maxAttempts = 30,
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const info = await connection.getAccountInfo(pda);
    if (info) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

export function useShield(): {
  executeShield: (params: {
    tokenSymbol: string;
    amount: number;
    tokenMint?: string;
  }) => Promise<ShieldResult>;
  executeUnshield: (params: {
    tokenSymbol: string;
    amount: number;
    tokenMint?: string;
  }) => Promise<ShieldResult>;
  loading: boolean;
  error: string | null;
} {
  const { keypair } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<unknown>(null);

  const solanaEnv = getSolanaEnv();
  const connection = getConnection();

  const getClient = useCallback(async () => {
    if (clientRef.current) return clientRef.current;

    if (!keypair) {
      throw new Error("Wallet keypair is not available");
    }

    const { LoyalPrivateTransactionsClient } = await getPrivateTransactions();
    const { rpcEndpoint, websocketEndpoint } = getEndpoints(solanaEnv);
    const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(solanaEnv);

    const client = await LoyalPrivateTransactionsClient.fromConfig({
      signer: keypair,
      baseRpcEndpoint: rpcEndpoint,
      baseWsEndpoint: websocketEndpoint,
      ephemeralRpcEndpoint: perRpcEndpoint,
      ephemeralWsEndpoint: perWsEndpoint,
    });

    clientRef.current = client;
    return client;
  }, [keypair, solanaEnv]);

  // Reset client when wallet changes
  const prevPubkey = useRef(keypair?.publicKey.toBase58());
  if (keypair?.publicKey.toBase58() !== prevPubkey.current) {
    clientRef.current = null;
    prevPubkey.current = keypair?.publicKey.toBase58();
  }

  const executeShield = useCallback(
    async (params: {
      tokenSymbol: string;
      amount: number;
      tokenMint?: string;
    }): Promise<ShieldResult> => {
      if (!keypair) {
        return {
          success: false,
          error: "Wallet not connected",
        };
      }

      setLoading(true);
      setError(null);

      try {
        const client = await getClient();
        const {
          DELEGATION_PROGRAM_ID,
          findDepositPda,
          getErValidatorForSolanaEnv,
          MAGIC_CONTEXT_ID,
          MAGIC_PROGRAM_ID,
        } = await getPrivateTransactions();
        const { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } =
          await getSplToken();
        const { wrapSolToWSol, closeWsolAta } = await getWsolAdapter();

        const resolvedMint =
          params.tokenMint || TOKEN_MINTS[params.tokenSymbol.toUpperCase()];
        if (!resolvedMint) {
          throw new Error(`Unknown token: ${params.tokenSymbol}`);
        }
        const tokenMint = new PublicKey(resolvedMint);
        const decimals =
          TOKEN_DECIMALS[params.tokenSymbol.toUpperCase()] ?? 6;
        const rawAmount = Math.floor(params.amount * 10 ** decimals);
        const user = keypair.publicKey;
        const validator = getErValidatorForSolanaEnv(solanaEnv);
        const isNativeSol = tokenMint.equals(NATIVE_MINT);

        // Init deposit if needed
        const baseDeposit = await client.getBaseDeposit(user, tokenMint);
        if (!baseDeposit) {
          await client.initializeDeposit({
            tokenMint,
            user,
            payer: user,
          });
          const [depositPda] = findDepositPda(user, tokenMint);
          await waitForAccount(connection, depositPda);
        }

        // Wrap SOL -> wSOL if native
        let createdAta = false;
        if (isNativeSol) {
          const result = await wrapSolToWSol({
            connection,
            keypair,
            lamports: rawAmount,
          });
          createdAta = result.createdAta;
        }

        const userTokenAccount = getAssociatedTokenAddressSync(
          tokenMint,
          user,
          false,
          TOKEN_PROGRAM_ID,
        );

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
          await closeWsolAta({
            connection,
            keypair,
            wsolAta: userTokenAccount,
          });
        }

        // Create permission (may already exist)
        try {
          await client.createPermission({
            tokenMint,
            user,
            payer: user,
          });
        } catch {
          // Permission may already exist
        }

        // Delegate deposit
        try {
          await client.delegateDeposit({
            tokenMint,
            user,
            payer: user,
            validator,
          });
        } catch {
          // May already be delegated
        }

        setLoading(false);
        return { success: true };
      } catch (err) {
        let errorMessage = "Shield failed";
        if (err instanceof Error) {
          errorMessage = err.message.includes("User rejected")
            ? "Transaction was rejected."
            : err.message;
        }
        setError(errorMessage);
        setLoading(false);
        return { success: false, error: errorMessage };
      }
    },
    [keypair, connection, getClient, solanaEnv],
  );

  const executeUnshield = useCallback(
    async (params: {
      tokenSymbol: string;
      amount: number;
      tokenMint?: string;
    }): Promise<ShieldResult> => {
      if (!keypair) {
        return {
          success: false,
          error: "Wallet not connected",
        };
      }

      setLoading(true);
      setError(null);

      try {
        const client = await getClient();
        const {
          DELEGATION_PROGRAM_ID,
          findDepositPda,
          getErValidatorForSolanaEnv,
          MAGIC_CONTEXT_ID,
          MAGIC_PROGRAM_ID,
        } = await getPrivateTransactions();
        const { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } =
          await getSplToken();
        const { closeWsolAta } = await getWsolAdapter();

        const resolvedMint =
          params.tokenMint || TOKEN_MINTS[params.tokenSymbol.toUpperCase()];
        if (!resolvedMint) {
          throw new Error(`Unknown token: ${params.tokenSymbol}`);
        }
        const tokenMint = new PublicKey(resolvedMint);
        const decimals =
          TOKEN_DECIMALS[params.tokenSymbol.toUpperCase()] ?? 6;
        const rawAmount = Math.floor(params.amount * 10 ** decimals);
        const user = keypair.publicKey;
        const isNativeSol = tokenMint.equals(NATIVE_MINT);

        const userTokenAccount = getAssociatedTokenAddressSync(
          tokenMint,
          user,
          false,
          TOKEN_PROGRAM_ID,
        );

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
          await closeWsolAta({
            connection,
            keypair,
            wsolAta: userTokenAccount,
          });
        }

        // Re-delegate deposit
        try {
          const validator = getErValidatorForSolanaEnv(solanaEnv);
          await client.delegateDeposit({
            tokenMint,
            user,
            payer: user,
            validator,
          });
        } catch {
          // May already be delegated or deposit empty
        }

        setLoading(false);
        return { success: true };
      } catch (err) {
        let errorMessage = "Unshield failed";
        if (err instanceof Error) {
          errorMessage = err.message.includes("User rejected")
            ? "Transaction was rejected."
            : err.message;
        }
        setError(errorMessage);
        setLoading(false);
        return { success: false, error: errorMessage };
      }
    },
    [keypair, connection, getClient, solanaEnv],
  );

  return { executeShield, executeUnshield, loading, error };
}
