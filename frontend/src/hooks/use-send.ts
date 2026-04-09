import type { AnalyticsProperties } from "@loyal-labs/shared/analytics";
import { TOKEN_DECIMALS, TOKEN_MINTS } from "@loyal-labs/wallet-core/constants";
import {
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { useCallback, useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { trackWalletSendCompleted } from "@/lib/core/analytics";

function cleanSolanaErrorMessage(message: string): string {
  const logsIndex = message.indexOf("Logs:");
  if (logsIndex !== -1) {
    return message.slice(0, logsIndex).trim();
  }
  return message;
}

export type SendResult = {
  signature?: string;
  success: boolean;
  error?: string;
};


/**
 * Convert token symbol to mint address
 * @param symbol - Token symbol (e.g., "SOL", "USDC")
 * @returns Mint address or undefined if not found
 */
const getTokenMint = (symbol: string): string | undefined => {
  const normalizedSymbol = symbol.toUpperCase();
  return TOKEN_MINTS[normalizedSymbol];
};

export function useSend() {
  const { connection } = useConnection();
  const { publicKey: walletPublicKey, connected: isConnected, sendTransaction } = useWallet();
  const publicEnv = usePublicEnv();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const executeSend = useCallback(
    async (
      currency: string,
      amount: string,
      recipientAddress: string,
      tokenMint?: string,
      tokenDecimals?: number,
      successTrackingProperties?: AnalyticsProperties
    ): Promise<SendResult> => {
      if (!(isConnected && walletPublicKey)) {
        const error = "Wallet not connected";
        setError(error);
        return { success: false, error };
      }

      setLoading(true);
      setError(null);

      try {
        const publicKey = walletPublicKey;
        const isSol = currency.toUpperCase() === "SOL";

        // Validate recipient address
        let recipientPubkey: PublicKey;
        try {
          recipientPubkey = new PublicKey(recipientAddress);
        } catch (err) {
          throw new Error("Invalid recipient wallet address");
        }

        // Get latest blockhash for the transaction
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash();

        if (isSol) {
          // Send native SOL
          const amountInLamports = Math.floor(
            Number.parseFloat(amount) * LAMPORTS_PER_SOL
          );

          console.log("Sending SOL:", {
            amount,
            amountInLamports,
            from: publicKey.toBase58(),
            to: recipientPubkey.toBase58(),
          });

          const transferInstruction = SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: recipientPubkey,
            lamports: amountInLamports,
          });

          // Create VersionedTransaction
          const messageV0 = new TransactionMessage({
            payerKey: publicKey,
            recentBlockhash: blockhash,
            instructions: [transferInstruction],
          }).compileToV0Message();

          const transaction = new VersionedTransaction(messageV0);

          console.log("Signing and sending transaction...");
          const signature = await sendTransaction(transaction, connection);

          console.log("Transaction sent:", signature);

          // Confirm transaction
          console.log("Confirming transaction...");
          const confirmation = await connection.confirmTransaction(
            {
              signature,
              blockhash,
              lastValidBlockHeight,
            },
            "confirmed"
          );

          if (confirmation.value.err) {
            throw new Error(
              `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
            );
          }

          console.log("Transaction confirmed!");
          setLoading(false);
          if (successTrackingProperties) {
            trackWalletSendCompleted(publicEnv, {
              ...successTrackingProperties,
              signature,
            });
          }
          return {
            signature,
            success: true,
          };
        }
        // Send SPL Token
        // Use provided tokenMint if available, otherwise try to look it up
        const resolvedTokenMint = tokenMint || getTokenMint(currency);
        if (!resolvedTokenMint) {
          throw new Error(
            `Unknown token: ${currency}. Please provide token mint address.`
          );
        }

        const mintPubkey = new PublicKey(resolvedTokenMint);

        // Get decimals for the token - use provided decimals or look up in mapping
        const decimals =
          tokenDecimals ?? TOKEN_DECIMALS[currency.toUpperCase()] ?? 6;
        const amountInSmallestUnit = Math.floor(
          Number.parseFloat(amount) * 10 ** decimals
        );

        console.log("Sending SPL token:", {
          currency,
          amount,
          amountInSmallestUnit,
          decimals,
          mint: tokenMint,
        });

        // Get associated token accounts
        const fromTokenAccount = await getAssociatedTokenAddress(
          mintPubkey,
          publicKey
        );

        const toTokenAccount = await getAssociatedTokenAddress(
          mintPubkey,
          recipientPubkey
        );

        console.log("Token accounts:", {
          from: fromTokenAccount.toBase58(),
          to: toTokenAccount.toBase58(),
        });

        // Check if recipient's ATA exists, create it if not
        let needsATA = false;

        try {
          await getAccount(connection, toTokenAccount);
          console.log("Recipient's token account exists");
        } catch (error) {
          // Account doesn't exist, will need to create it
          console.log(
            "Recipient's token account doesn't exist, will create it"
          );
          needsATA = true;
        }

        // Construct transaction instructions
        const instructions = [];

        // Add priority fee and compute budget if creating ATA
        if (needsATA) {
          console.log("Adding ATA creation instructions...");
          // Increase compute budget for ATA creation + transfer
          instructions.push(
            ComputeBudgetProgram.setComputeUnitLimit({
              units: 300_000,
            })
          );
          // Add priority fee
          instructions.push(
            ComputeBudgetProgram.setComputeUnitPrice({
              microLamports: 1000,
            })
          );

          // Add ATA creation instruction
          instructions.push(
            createAssociatedTokenAccountInstruction(
              publicKey, // payer
              toTokenAccount, // ata
              recipientPubkey, // owner
              mintPubkey // mint
            )
          );
        }

        // Add transfer instruction
        instructions.push(
          createTransferInstruction(
            fromTokenAccount,
            toTokenAccount,
            publicKey,
            amountInSmallestUnit
          )
        );

        // Create VersionedTransaction
        const messageV0 = new TransactionMessage({
          payerKey: publicKey,
          recentBlockhash: blockhash,
          instructions,
        }).compileToV0Message();

        const transaction = new VersionedTransaction(messageV0);

        console.log("Signing and sending transaction...");
        const signature = await sendTransaction(transaction, connection);

        console.log("Transaction sent:", signature);

        // Confirm transaction
        console.log("Confirming transaction...");
        const confirmation = await connection.confirmTransaction(
          {
            signature,
            blockhash,
            lastValidBlockHeight,
          },
          "confirmed"
        );

        if (confirmation.value.err) {
          throw new Error(
            `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
          );
        }

        console.log("Transaction confirmed!");
        setLoading(false);
        if (successTrackingProperties) {
          trackWalletSendCompleted(publicEnv, {
            ...successTrackingProperties,
            signature,
          });
        }
        return {
          signature,
          success: true,
        };
      } catch (err) {
        let errorMessage = "Send execution failed";

        if (err instanceof Error) {
          // Handle timeout errors specifically
          if (
            err.message.includes("timeout") ||
            err.message.includes("Timeout")
          ) {
            errorMessage =
              "Transaction signing timed out. Please try again and approve the transaction in your wallet promptly.";
          } else if (err.message.includes("User rejected")) {
            errorMessage = "Transaction was rejected in your wallet.";
          } else {
            errorMessage = cleanSolanaErrorMessage(err.message);
          }
        }

        setError(errorMessage);
        console.error("Send execution error:", err);
        setLoading(false);
        return { success: false, error: errorMessage };
      }
    },
    [
      isConnected,
      walletPublicKey,
      sendTransaction,
      connection,
      publicEnv,
    ]
  );

  return {
    executeSend,
    loading,
    error,
  };
}
