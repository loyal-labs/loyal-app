import {
  DELEGATION_PROGRAM_ID,
  findDepositPda,
  findUsernameDepositPda,
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
import { trackWalletSendCompleted } from "@/lib/core/analytics";
import { closeWsolAta, wrapSolToWSol } from "@/lib/solana/wsol-adapter";

export type PrivateSendResult = {
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

export function usePrivateSend() {
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
      throw new Error("Wallet must support signTransaction, signAllTransactions, and signMessage for private send");
    }

    const { rpcEndpoint, websocketEndpoint } = getSolanaEndpoints(publicEnv.solanaEnv);
    const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(publicEnv.solanaEnv);

    // The SDK internally checks for signMessage on the signer at runtime
    // for TEE auth, even though WalletLike type doesn't declare it
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

  const executePrivateSend = useCallback(
    async (params: {
      tokenSymbol: string;
      amount: number;
      recipient: string;
      recipientType: "wallet" | "telegram";
      tokenMint?: string;
      successTrackingProperties?: AnalyticsProperties;
    }): Promise<PrivateSendResult> => {
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

        // 1. Check ephemeral balance — skip shield if sufficient
        const existingDeposit = await client.getEphemeralDeposit(user, tokenMint);
        const existingBalance = existingDeposit?.amount ?? BigInt(0);
        const needsShield = existingBalance < BigInt(rawAmount);

        if (needsShield) {
          // Shield flow: init deposit → wrap wSOL → undelegate → modifyBalance → permission → delegate

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

          // Move tokens into deposit vault
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
        }

        // 2. Transfer
        let signature: string;

        if (params.recipientType === "telegram") {
          // Transfer to username
          const username = params.recipient;
          const existingBase = await client.getBaseUsernameDeposit(username, tokenMint);
          const existingEphemeral = await client.getEphemeralUsernameDeposit(username, tokenMint);

          if (!existingBase && !existingEphemeral) {
            await client.initializeUsernameDeposit({ tokenMint, username, payer: user });
            const [pda] = await findUsernameDepositPda(username, tokenMint);
            await waitForAccount(connection, pda);
          }

          const [pda] = await findUsernameDepositPda(username, tokenMint);
          const baseInfo = await connection.getAccountInfo(pda);
          if (!baseInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
            await client.delegateUsernameDeposit({ tokenMint, username, payer: user, validator });
          }

          signature = await client.transferToUsernameDeposit({
            username,
            user,
            tokenMint,
            amount: rawAmount,
            payer: user,
          });
        } else {
          // Transfer to wallet address
          const destination = new PublicKey(params.recipient);
          const existingBase = await client.getBaseDeposit(destination, tokenMint);

          if (!existingBase) {
            await client.initializeDeposit({ tokenMint, user: destination, payer: user });
            const [pda] = findDepositPda(destination, tokenMint);
            await waitForAccount(connection, pda);
          }

          const [pda] = findDepositPda(destination, tokenMint);
          const destInfo = await connection.getAccountInfo(pda);
          if (!destInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
            await client.delegateDeposit({ tokenMint, user: destination, payer: user, validator });
          }

          signature = await client.transferDeposit({
            user,
            tokenMint,
            destinationUser: destination,
            amount: rawAmount,
            payer: user,
          });
        }

        setLoading(false);
        if (params.successTrackingProperties) {
          trackWalletSendCompleted(publicEnv, {
            ...params.successTrackingProperties,
            signature,
          });
        }
        return { signature, success: true };
      } catch (err) {
        let errorMessage = "Private send failed";
        if (err instanceof Error) {
          if (err.message.includes("User rejected")) {
            errorMessage = "Transaction was rejected in your wallet.";
          } else {
            errorMessage = err.message;
          }
        }
        setError(errorMessage);
        setLoading(false);
        return { success: false, error: errorMessage };
      }
    },
    [wallet.connected, wallet.publicKey, wallet.signTransaction, connection, getClient, publicEnv],
  );

  return {
    executePrivateSend,
    loading,
    error,
  };
}
