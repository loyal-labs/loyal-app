import type {
	Connection,
	ParsedAccountData,
	VersionedTransaction,
} from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useState } from "react";

import { TOKEN_MINTS } from "../constants/token-mints";
import {
	deserializeJupiterSwapTransaction,
	getJupiterQuote,
	getJupiterSwapTransaction,
} from "../lib/jupiter/client";
import type { JupiterQuoteResponse } from "../lib/jupiter/types";
import type { WalletSigner } from "../types/signer";

// Debug logger that only emits in development
const logger = {
	debug: (...args: unknown[]) => {
		if (
			typeof process !== "undefined" &&
			process.env?.NODE_ENV === "development"
		) {
			console.log(...args);
		}
	},
};

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

export type SwapConfig =
	| { mode: "enabled"; apiKey?: string; baseUrl?: string }
	| { mode: "disabled"; reason: string };

const getTokenMint = (symbol: string): string | undefined => {
	return TOKEN_MINTS[symbol.toUpperCase()];
};

async function sendTransactionViaSigner(
	signer: WalletSigner,
	connection: Connection,
	transaction: VersionedTransaction
): Promise<string> {
	if (signer.sendTransaction) {
		return signer.sendTransaction(transaction);
	}
	const signed = await signer.signTransaction(transaction);
	return connection.sendRawTransaction(signed.serialize());
}

export function useSwap(
	signer: WalletSigner | null,
	connection: Connection,
	swapConfig: SwapConfig
) {
	const isSwapEnabled = swapConfig.mode === "enabled";
	const swapApiKey = isSwapEnabled ? swapConfig.apiKey : undefined;
	const swapBaseUrl = isSwapEnabled ? swapConfig.baseUrl : undefined;
	const unavailableReason =
		swapConfig.mode === "disabled" ? swapConfig.reason : null;
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
					throw new Error(unavailableReason ?? "Swap unavailable");
				}

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
					baseUrl: swapBaseUrl,
				});
				logger.debug("Jupiter Quote response:", data);

				setQuoteResponse(data);

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
			swapApiKey,
			swapBaseUrl,
			unavailableReason,
		]
	);

	const executeSwap = useCallback(async (): Promise<SwapResult> => {
		if (!isSwapEnabled) {
			const errorMsg = unavailableReason ?? "Swap unavailable";
			setError(errorMsg);
			return { success: false, error: errorMsg };
		}

		if (!signer) {
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
				userPublicKey: signer.publicKey.toBase58(),
				quoteResponse,
				apiKey: swapApiKey,
				baseUrl: swapBaseUrl,
			});
			logger.debug("Jupiter Swap transaction response:", swapData);

			const { swapTransaction: serializedTx } = swapData;
			if (!serializedTx) {
				throw new Error("No transaction returned from Jupiter Swap API");
			}

			const transaction = deserializeJupiterSwapTransaction(serializedTx);

			logger.debug("Signing and sending transaction...");
			const signature = await sendTransactionViaSigner(
				signer,
				connection,
				transaction
			);

			logger.debug("Transaction sent:", signature);

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
			return { signature, success: true };
		} catch (err) {
			let errorMessage = "Swap execution failed";
			if (err instanceof Error) {
				if (
					err.message.includes("timeout") ||
					err.message.includes("Timeout")
				) {
					errorMessage =
						"Transaction signing timed out. Please try again and approve the transaction in your wallet promptly.";
				} else if (err.message.includes("User rejected")) {
					errorMessage = "Transaction was rejected in your wallet.";
				} else {
					errorMessage = err.message;
				}
			}
			setError(errorMessage);
			logger.debug("Swap execution error:", err);
			setLoading(false);
			return { success: false, error: errorMessage };
		}
	}, [
		connection,
		isSwapEnabled,
		signer,
		quoteResponse,
		swapApiKey,
		swapBaseUrl,
		unavailableReason,
	]);

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
		quoteResponse,
		isAvailable: isSwapEnabled,
		unavailableReason,
	};
}
