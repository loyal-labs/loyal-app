import type { Connection, ParsedAccountData } from "@solana/web3.js";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { useCallback, useState } from "react";

import { TOKEN_MINTS } from "../constants/token-mints";
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
	| { mode: "enabled"; apiKey: string }
	| { mode: "disabled"; reason: string };

const JUPITER_QUOTE_API_URL = "https://api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_API_URL = "https://api.jup.ag/swap/v1/swap";

type JupiterQuoteResponse = {
	inputMint: string;
	inAmount: string;
	outputMint: string;
	outAmount: string;
	otherAmountThreshold: string;
	swapMode: string;
	slippageBps: number;
	platformFee: null | { amount: string; feeBps: number };
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

const getTokenMint = (symbol: string): string | undefined => {
	return TOKEN_MINTS[symbol.toUpperCase()];
};

async function sendTransactionViaSigner(
	signer: WalletSigner,
	connection: Connection,
	transaction: VersionedTransaction,
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
	swapConfig: SwapConfig,
) {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [quote, setQuote] = useState<SwapQuote | null>(null);
	const [quoteResponse, setQuoteResponse] =
		useState<JupiterQuoteResponse | null>(null);

	const getTokenDecimals = useCallback(
		async (mintAddress: string): Promise<number> => {
			const mintPublicKey = new PublicKey(mintAddress);
			const accountInfo =
				await connection.getParsedAccountInfo(mintPublicKey);
			const data = accountInfo.value?.data;

			if (data && typeof data === "object" && "parsed" in data) {
				const parsedData = data as ParsedAccountData;
				const decimals = parsedData.parsed?.info?.decimals;
				if (typeof decimals === "number") {
					return decimals;
				}
			}

			throw new Error(
				`Unable to determine token decimals for mint ${mintAddress}`,
			);
		},
		[connection],
	);

	const getQuote = useCallback(
		async (
			fromToken: string,
			toToken: string,
			amount: string,
			fromTokenMint?: string,
			fromTokenDecimals?: number,
			toTokenDecimals?: number,
			toTokenMint?: string,
		): Promise<SwapQuote | null> => {
			try {
				setError(null);

				if (swapConfig.mode === "disabled") {
					throw new Error(swapConfig.reason);
				}

				const inputMint = fromTokenMint || getTokenMint(fromToken);
				const outputMint = toTokenMint || getTokenMint(toToken);

				if (!inputMint) {
					throw new Error(
						`Unknown token: ${fromToken}. Please provide token mint address.`,
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
					Number.parseFloat(amount) * 10 ** inputDecimals,
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

				const url = `${JUPITER_QUOTE_API_URL}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountInSmallestUnit}&slippageBps=50`;
				logger.debug("Fetching quote from Jupiter API:", url);

				const response = await fetch(url, {
					headers: { "x-api-key": swapConfig.apiKey },
				});

				if (!response.ok) {
					const errorText = await response.text();
					logger.debug("Quote API error:", errorText);
					throw new Error(
						`Failed to get quote: ${response.statusText}`,
					);
				}

				const data: JupiterQuoteResponse = await response.json();
				logger.debug("Jupiter Quote response:", data);

				setQuoteResponse(data);

				const outputDecimals = await outputDecimalsPromise;
				const outputAmount = (
					Number.parseInt(data.outAmount, 10) /
					10 ** outputDecimals
				).toFixed(outputDecimals);

				const priceImpact = `${(
					Number.parseFloat(data.priceImpactPct) *
					PERCENTAGE_MULTIPLIER
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
					err instanceof Error
						? err.message
						: "Failed to get quote";
				setError(errorMessage);
				logger.debug("Quote error:", err);
				return null;
			}
		},
		[getTokenDecimals, swapConfig],
	);

	const executeSwap = useCallback(async (): Promise<SwapResult> => {
		if (swapConfig.mode === "disabled") {
			setError(swapConfig.reason);
			return { success: false, error: swapConfig.reason };
		}

		if (!signer) {
			const errorMsg = "Wallet not connected";
			setError(errorMsg);
			return { success: false, error: errorMsg };
		}

		if (!quoteResponse) {
			const errorMsg =
				"No quote available. Please get a quote first.";
			setError(errorMsg);
			return { success: false, error: errorMsg };
		}

		setLoading(true);
		setError(null);

		try {
			logger.debug("Executing swap with quote:", quoteResponse);

			const swapResponse = await fetch(JUPITER_SWAP_API_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": (swapConfig as { apiKey: string }).apiKey,
				},
				body: JSON.stringify({
					userPublicKey: signer.publicKey.toBase58(),
					quoteResponse,
					wrapAndUnwrapSol: true,
					dynamicComputeUnitLimit: true,
					prioritizationFeeLamports: {
						priorityLevelWithMaxLamports: {
							priorityLevel: "veryHigh",
							maxLamports: 50_000_000,
							global: true,
						},
					},
				}),
			});

			if (!swapResponse.ok) {
				const errorText = await swapResponse.text();
				logger.debug("Jupiter Swap API error:", errorText);
				throw new Error(
					`Jupiter Swap API failed: ${swapResponse.statusText}`,
				);
			}

			const swapData: JupiterSwapResponse = await swapResponse.json();
			logger.debug("Jupiter Swap transaction response:", swapData);

			const { swapTransaction: serializedTx } = swapData;
			if (!serializedTx) {
				throw new Error(
					"No transaction returned from Jupiter Swap API",
				);
			}

			const txBuffer = Buffer.from(serializedTx, "base64");
			const transaction =
				VersionedTransaction.deserialize(new Uint8Array(txBuffer));

			logger.debug("Signing and sending transaction...");
			const signature = await sendTransactionViaSigner(
				signer,
				connection,
				transaction,
			);

			logger.debug("Transaction sent:", signature);

			const latestBlockhash =
				await connection.getLatestBlockhash("confirmed");
			const confirmation = await connection.confirmTransaction(
				{
					signature,
					blockhash: latestBlockhash.blockhash,
					lastValidBlockHeight:
						latestBlockhash.lastValidBlockHeight,
				},
				"confirmed",
			);

			if (confirmation.value.err) {
				throw new Error(
					`Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
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
					errorMessage =
						"Transaction was rejected in your wallet.";
				} else {
					errorMessage = err.message;
				}
			}
			setError(errorMessage);
			logger.debug("Swap execution error:", err);
			setLoading(false);
			return { success: false, error: errorMessage };
		}
	}, [connection, signer, quoteResponse, swapConfig]);

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
