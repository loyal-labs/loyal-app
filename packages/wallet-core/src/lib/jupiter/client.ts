import type { JupiterQuoteResponse, JupiterSwapResponse } from "./types";

const JUPITER_QUOTE_API_URL = "https://lite-api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_API_URL = "https://lite-api.jup.ag/swap/v1/swap";

const buildJupiterHeaders = (
	apiKey: string,
	extra?: Record<string, string>,
): Record<string, string> => ({
	...(extra ?? {}),
	...(apiKey ? { "x-api-key": apiKey } : {}),
});

export interface JupiterQuoteParams {
	inputMint: string;
	outputMint: string;
	amount: string; // in smallest unit (lamports etc.)
	slippageBps?: number;
	apiKey: string;
}

export async function getJupiterQuote(
	params: JupiterQuoteParams,
): Promise<JupiterQuoteResponse> {
	const { inputMint, outputMint, amount, slippageBps = 50, apiKey } = params;

	const url = `${JUPITER_QUOTE_API_URL}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`;

	const response = await fetch(url, {
		headers: buildJupiterHeaders(apiKey),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Failed to get Jupiter quote: ${response.statusText} - ${errorText}`,
		);
	}

	return response.json();
}

export interface JupiterSwapParams {
	userPublicKey: string;
	quoteResponse: JupiterQuoteResponse;
	apiKey: string;
	wrapAndUnwrapSol?: boolean;
	dynamicComputeUnitLimit?: boolean;
	priorityLevel?: string;
	maxPriorityFeeLamports?: number;
}

export async function executeJupiterSwap(
	params: JupiterSwapParams,
): Promise<JupiterSwapResponse> {
	const {
		userPublicKey,
		quoteResponse,
		apiKey,
		wrapAndUnwrapSol = true,
		dynamicComputeUnitLimit = true,
		priorityLevel = "veryHigh",
		maxPriorityFeeLamports = 50_000_000,
	} = params;

	const response = await fetch(JUPITER_SWAP_API_URL, {
		method: "POST",
		headers: buildJupiterHeaders(apiKey, {
			"Content-Type": "application/json",
		}),
		body: JSON.stringify({
			userPublicKey,
			quoteResponse,
			wrapAndUnwrapSol,
			dynamicComputeUnitLimit,
			prioritizationFeeLamports: {
				priorityLevelWithMaxLamports: {
					priorityLevel,
					maxLamports: maxPriorityFeeLamports,
					global: true,
				},
			},
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Jupiter Swap API failed: ${response.statusText} - ${errorText}`,
		);
	}

	return response.json();
}
