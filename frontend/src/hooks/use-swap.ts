import { TOKEN_MINTS } from "@loyal-labs/wallet-core/constants";
import {
  DEFAULT_JUPITER_SWAP_API_BASE_URL,
  deserializeJupiterSwapTransaction,
  getJupiterQuote,
  getJupiterSwapTransaction,
  type JupiterQuoteResponse,
} from "@loyal-labs/wallet-core/lib";
import type { AnalyticsProperties } from "@loyal-labs/shared/analytics";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  type ParsedAccountData,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import { useCallback, useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import { trackWalletSwapCompleted } from "@/lib/core/analytics";

// Debug logger that only emits in development
const logger = {
  debug: (...args: unknown[]) => {
    if (process.env.NODE_ENV === "development") {
      // biome-ignore lint/suspicious/noConsole: Development logging
      console.log(...args);
    }
  },
};

function cleanSolanaErrorMessage(message: string): string {
  const logsIndex = message.indexOf("Logs:");
  if (logsIndex !== -1) {
    return message.slice(0, logsIndex).trim();
  }
  return message;
}

// Constants
const PERCENTAGE_MULTIPLIER = 100;

export type SwapQuote = {
  inputAmount: string;
  outputAmount: string;
  inputToken: string;
  outputToken: string;
  priceImpact?: string;
  fee?: string;
};

export type SwapResult = {
  signature?: string;
  success: boolean;
  error?: string;
  status?: "executed" | "proposed";
};

export type SwapExecutionContext = {
  executeTransaction: (
    transaction: VersionedTransaction
  ) => Promise<SwapResult>;
  userPublicKey: PublicKey | string | null;
};

// Use Jupiter Swap v1 API with paid tier endpoint when frontend config allows it.
export const FRONTEND_JUPITER_SWAP_API_BASE_URL = "https://api.jup.ag/swap/v1";

/**
 * Convert token symbol to mint address
 * @param symbol - Token symbol (e.g., "SOL", "USDC")
 * @returns Mint address or undefined if not found
 */
const getTokenMint = (symbol: string): string | undefined => {
  const normalizedSymbol = symbol.toUpperCase();
  return TOKEN_MINTS[normalizedSymbol];
};

export function useSwap() {
  const { connection } = useConnection();
  const { publicKey, connected: isConnected, sendTransaction } = useWallet();
  const publicEnv = usePublicEnv();
  const { swap: swapConfig } = publicEnv;
  const isSwapEnabled = swapConfig.mode === "enabled";
  const swapApiKey = isSwapEnabled ? swapConfig.apiKey : undefined;
  const swapUnavailableReason =
    swapConfig.mode === "disabled" ? swapConfig.reason : null;
  const swapApiBaseUrl = isSwapEnabled
    ? FRONTEND_JUPITER_SWAP_API_BASE_URL
    : DEFAULT_JUPITER_SWAP_API_BASE_URL;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteResponse, setQuoteResponse] =
    useState<JupiterQuoteResponse | null>(null);
  const getTokenDecimals = useCallback(
    async (mintAddress: string): Promise<number> => {
      const mintPublicKey = new PublicKey(mintAddress);
      const accountInfo = await connection.getParsedAccountInfo(mintPublicKey);
      const data = accountInfo.value?.data;

      if (data && typeof data === "object" && "parsed" in data) {
        const parsedData = data as ParsedAccountData;
        const decimals = parsedData.parsed?.info?.decimals;
        if (typeof decimals === "number") {
          return decimals;
        }
      }

      throw new Error(
        `Unable to determine token decimals for mint ${mintAddress}`
      );
    },
    [connection]
  );

  const getQuote = useCallback(
    async (
      fromToken: string,
      toToken: string,
      amount: string,
      fromTokenMint?: string,
      fromTokenDecimals?: number,
      toTokenDecimals?: number,
      toTokenMint?: string
    ): Promise<SwapQuote | null> => {
      try {
        setError(null);

        if (!isSwapEnabled) {
          throw new Error(swapUnavailableReason ?? "Swap unavailable");
        }

        // Convert token symbols to mint addresses
        // Use provided mints if available, otherwise look up
        const inputMint = fromTokenMint || getTokenMint(fromToken);
        const outputMint = toTokenMint || getTokenMint(toToken);

        if (!inputMint) {
          throw new Error(
            `Unknown token: ${fromToken}. Please provide token mint address.`
          );
        }
        if (!outputMint) {
          throw new Error(`Unknown token: ${toToken}`);
        }

        // Convert amount to lamports (smallest unit)
        // Use provided decimals if available, otherwise fetch from mint account
        const inputDecimalsPromise = fromTokenDecimals
          ? Promise.resolve(fromTokenDecimals)
          : getTokenDecimals(inputMint);
        const outputDecimalsPromise = toTokenDecimals
          ? Promise.resolve(toTokenDecimals)
          : getTokenDecimals(outputMint);
        const inputDecimals = await inputDecimalsPromise;
        const amountInSmallestUnit = Math.floor(
          Number.parseFloat(amount) * 10 ** inputDecimals
        ).toString();

        logger.debug("Token conversion:", {
          fromToken,
          inputMint,
          toToken,
          outputMint,
          amount,
          amountInSmallestUnit,
          decimals: inputDecimals,
        });

        const data = await getJupiterQuote({
          inputMint,
          outputMint,
          amount: amountInSmallestUnit,
          slippageBps: 50,
          apiKey: swapApiKey,
          baseUrl: swapApiBaseUrl,
        });
        logger.debug("Jupiter Quote response:", data);

        // Store the full quote response for later use in executeSwap
        setQuoteResponse(data);

        // Convert output amount from smallest unit back to tokens
        const outputDecimals = await outputDecimalsPromise;
        const outputAmount = (
          Number.parseInt(data.outAmount, 10) /
          10 ** outputDecimals
        ).toFixed(outputDecimals);

        const priceImpact = `${(
          Number.parseFloat(data.priceImpactPct) * PERCENTAGE_MULTIPLIER
        ).toFixed(2)}%`;

        const quoteData: SwapQuote = {
          inputAmount: amount,
          outputAmount,
          inputToken: fromToken,
          outputToken: toToken,
          priceImpact,
          fee: undefined,
        };

        logger.debug("Parsed quote data:", quoteData);
        setQuote(quoteData);
        return quoteData;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to get quote";
        setError(errorMessage);
        logger.debug("Quote error:", err);
        return null;
      }
    },
    [
      getTokenDecimals,
      isSwapEnabled,
      swapApiBaseUrl,
      swapApiKey,
      swapUnavailableReason,
    ]
  );

  const executeSwap = useCallback(
    async (
      successTrackingProperties?: AnalyticsProperties,
      executionContext?: SwapExecutionContext
    ): Promise<SwapResult> => {
      if (!isSwapEnabled) {
        const errorMsg = swapUnavailableReason ?? "Swap unavailable";
        setError(errorMsg);
        return { success: false, error: errorMsg };
      }

      const swapUserPublicKey = executionContext?.userPublicKey
        ? typeof executionContext.userPublicKey === "string"
          ? new PublicKey(executionContext.userPublicKey)
          : executionContext.userPublicKey
        : publicKey;

      if (!swapUserPublicKey || (!executionContext && !isConnected)) {
        const errorMsg = "Wallet not connected";
        setError(errorMsg);
        return { success: false, error: errorMsg };
      }

      if (!quoteResponse) {
        const errorMsg = "No quote available. Please get a quote first.";
        setError(errorMsg);
        return { success: false, error: errorMsg };
      }

      setLoading(true);
      setError(null);

      try {
        logger.debug("Executing swap with quote:", quoteResponse);

        const swapData = await getJupiterSwapTransaction({
          userPublicKey: swapUserPublicKey.toBase58(),
          quoteResponse,
          apiKey: swapApiKey,
          baseUrl: swapApiBaseUrl,
        });
        logger.debug("Jupiter Swap transaction response:", swapData);

        const { swapTransaction: serializedTx } = swapData;
        if (!serializedTx) {
          throw new Error("No transaction returned from Jupiter Swap API");
        }

        const transaction = deserializeJupiterSwapTransaction(serializedTx);

        logger.debug("Signing and sending transaction...");
        const executionResult = executionContext
          ? await executionContext.executeTransaction(transaction)
          : {
              signature: await sendTransaction(transaction, connection),
              success: true,
              status: "executed" as const,
            };

        if (!executionResult.success) {
          throw new Error(executionResult.error ?? "Swap execution failed");
        }

        const signature = executionResult.signature;

        logger.debug("Transaction sent:", signature);
        logger.debug(
          `View transaction: https://orbmarkets.io/tx/${signature}?tab=summary`
        );

        if (!executionContext && signature) {
          // Step 4: Confirm transaction with proper strategy
          logger.debug("Confirming transaction...");
          const latestBlockhash = await connection.getLatestBlockhash(
            "confirmed"
          );
          const confirmation = await connection.confirmTransaction(
            {
              signature,
              blockhash: latestBlockhash.blockhash,
              lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            },
            "confirmed"
          );

          if (confirmation.value.err) {
            throw new Error(
              `Transaction failed: ${JSON.stringify(confirmation.value.err)}`
            );
          }
        }

        logger.debug("Transaction confirmed!");
        setLoading(false);
        if (successTrackingProperties) {
          trackWalletSwapCompleted(publicEnv, {
            ...successTrackingProperties,
            signature,
          });
        }
        return {
          signature,
          success: true,
          status: executionResult.status,
        };
      } catch (err) {
        let errorMessage = "Swap execution failed";

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
        logger.debug("Swap execution error:", err);
        setLoading(false);
        return { success: false, error: errorMessage };
      }
    },
    [
      connection,
      isConnected,
      isSwapEnabled,
      publicEnv,
      publicKey,
      quoteResponse,
      sendTransaction,
      swapApiBaseUrl,
      swapApiKey,
      swapUnavailableReason,
    ]
  );

  const resetQuote = useCallback(() => {
    setQuote(null);
    setQuoteResponse(null);
    setError(null);
  }, []);

  return {
    getQuote,
    executeSwap,
    resetQuote,
    quote,
    quoteResponse,
    loading,
    error,
    userPublicKey: publicKey,
    swapApiBaseUrl,
    swapApiKey,
    isAvailable: isSwapEnabled,
    unavailableReason: swapUnavailableReason,
  };
}
