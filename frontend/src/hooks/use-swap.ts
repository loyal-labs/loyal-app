import { TOKEN_MINTS } from "@loyal-labs/wallet-core/constants";
import type { AnalyticsProperties } from "@loyal-labs/shared/analytics";
import {
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
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
};

// Use Jupiter Swap v1 API with paid tier endpoint
const JUPITER_QUOTE_API_URL = "https://api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_API_URL = "https://api.jup.ag/swap/v1/swap";

/**
 * Convert token symbol to mint address
 * @param symbol - Token symbol (e.g., "SOL", "USDC")
 * @returns Mint address or undefined if not found
 */
const getTokenMint = (symbol: string): string | undefined => {
  const normalizedSymbol = symbol.toUpperCase();
  return TOKEN_MINTS[normalizedSymbol];
};

type JupiterQuoteResponse = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee: null | {
    amount: string;
    feeBps: number;
  };
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }>;
  contextSlot?: number;
  timeTaken?: number;
};

type JupiterSwapResponse = {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
};

export function useSwap() {
  const { connection } = useConnection();
  const { publicKey, connected: isConnected, sendTransaction } = useWallet();
  const publicEnv = usePublicEnv();
  const { swap: swapConfig } = publicEnv;
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

        if (swapConfig.mode === "disabled") {
          throw new Error(swapConfig.reason);
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

        // Build Jupiter Quote API URL
        const url = `${JUPITER_QUOTE_API_URL}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountInSmallestUnit}&slippageBps=50`;
        logger.debug("Fetching quote from Jupiter API:", url);

        const response = await fetch(url, {
          headers: {
            "x-api-key": swapConfig.apiKey,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.debug("Quote API error:", errorText);
          throw new Error(`Failed to get quote: ${response.statusText}`);
        }

        const data: JupiterQuoteResponse = await response.json();
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
    [getTokenDecimals, swapConfig]
  );

  const executeSwap = useCallback(
    async (successTrackingProperties?: AnalyticsProperties): Promise<SwapResult> => {
      if (swapConfig.mode === "disabled") {
        setError(swapConfig.reason);
        return { success: false, error: swapConfig.reason };
      }

      if (!(isConnected && publicKey)) {
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

        // Step 1: Call Jupiter Swap API to get transaction
        logger.debug("Calling Jupiter Swap API...");

        const swapResponse = await fetch(JUPITER_SWAP_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": swapConfig.apiKey,
          },
          body: JSON.stringify({
            userPublicKey: publicKey.toBase58(),
            quoteResponse,
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
            prioritizationFeeLamports: {
              priorityLevelWithMaxLamports: {
                priorityLevel: "veryHigh",
                maxLamports: 50_000_000, // 0.05 SOL max for priority
                global: true, // Use global fee market
              },
            },
          }),
        });

        if (!swapResponse.ok) {
          const errorText = await swapResponse.text();
          logger.debug("Jupiter Swap API error:", errorText);
          throw new Error(`Jupiter Swap API failed: ${swapResponse.statusText}`);
        }

        const swapData: JupiterSwapResponse = await swapResponse.json();
        logger.debug("Jupiter Swap transaction response:", swapData);

        const { swapTransaction: serializedTx } = swapData;
        if (!serializedTx) {
          throw new Error("No transaction returned from Jupiter Swap API");
        }

      // Step 2: Deserialize transaction
        const txBuffer = Buffer.from(serializedTx, "base64");
        const transaction = VersionedTransaction.deserialize(txBuffer);

      // Step 3: Sign and send transaction using wallet-adapter
        logger.debug("Signing and sending transaction...");
        const signature = await sendTransaction(transaction, connection);

        logger.debug("Transaction sent:", signature);
        logger.debug(
          `View transaction: https://orbmarkets.io/tx/${signature}?tab=summary`
        );

      // Step 4: Confirm transaction with proper strategy
        logger.debug("Confirming transaction...");
        const latestBlockhash = await connection.getLatestBlockhash("confirmed");
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
    [connection, isConnected, publicEnv, publicKey, quoteResponse, sendTransaction, swapConfig]
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
    loading,
    error,
    isAvailable: swapConfig.mode === "enabled",
    unavailableReason:
      swapConfig.mode === "disabled" ? swapConfig.reason : null,
  };
}
