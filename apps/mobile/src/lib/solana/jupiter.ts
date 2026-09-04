import {
  estimateJupiterSwapFeeState as estimateCoreJupiterSwapFeeState,
  getJupiterSwapFeeEstimateFlowKey as getCoreJupiterSwapFeeEstimateFlowKey,
  getJupiterSwapFeeEstimateKey as getCoreJupiterSwapFeeEstimateKey,
  getSwapFeeEstimateDebounceMs,
  getSwapFeeEstimateDisplayState,
  getJupiterQuote as getCoreJupiterQuote,
  getJupiterSwapInstructions as getCoreJupiterSwapInstructions,
  getJupiterSwapTransaction as getCoreJupiterSwapTransaction,
  isNonEmptySwapFeeEstimateState,
  type JupiterQuoteResponse,
  type JupiterSwapInstructionsResponse,
  type JupiterSwapResponse,
  type SwapFeeEstimate,
  type SwapFeeEstimateConnection,
  type SwapFeeEstimateState,
  SWAP_FEE_ESTIMATE_DEBOUNCE_MS,
} from "@loyal-labs/wallet-core/lib";

const JUPITER_SWAP_API_BASE_URL = "https://api.jup.ag/swap/v1";

export type {
  JupiterQuoteResponse,
  JupiterSwapInstructionsResponse,
  JupiterSwapResponse,
  SwapFeeEstimate,
  SwapFeeEstimateConnection,
  SwapFeeEstimateState,
};
export {
  getSwapFeeEstimateDebounceMs,
  getSwapFeeEstimateDisplayState,
  isNonEmptySwapFeeEstimateState,
  SWAP_FEE_ESTIMATE_DEBOUNCE_MS,
};

export async function getJupiterQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
}): Promise<JupiterQuoteResponse> {
  return getCoreJupiterQuote({
    ...params,
    baseUrl: JUPITER_SWAP_API_BASE_URL,
  });
}

export async function getJupiterSwapTransaction(params: {
  quoteResponse: JupiterQuoteResponse;
  userPublicKey: string;
}): Promise<JupiterSwapResponse> {
  return getCoreJupiterSwapTransaction({
    ...params,
    baseUrl: JUPITER_SWAP_API_BASE_URL,
  });
}

export async function getJupiterSwapInstructions(params: {
  quoteResponse: JupiterQuoteResponse;
  userPublicKey: string;
}): Promise<JupiterSwapInstructionsResponse> {
  return getCoreJupiterSwapInstructions({
    ...params,
    baseUrl: JUPITER_SWAP_API_BASE_URL,
  });
}

export async function estimateJupiterSwapFeeState(params: {
  connection: SwapFeeEstimateConnection;
  quoteResponse: JupiterQuoteResponse;
  userPublicKey: string;
  signal?: AbortSignal;
}): Promise<SwapFeeEstimateState> {
  return estimateCoreJupiterSwapFeeState({
    ...params,
    baseUrl: JUPITER_SWAP_API_BASE_URL,
  });
}

export function getJupiterSwapFeeEstimateKey(params: {
  connection?: SwapFeeEstimateConnection;
  quoteResponse: JupiterQuoteResponse;
  userPublicKey: string;
}): string {
  return getCoreJupiterSwapFeeEstimateKey({
    ...params,
    baseUrl: JUPITER_SWAP_API_BASE_URL,
  });
}

export function getJupiterSwapFeeEstimateFlowKey(params: {
  inputMint: string;
  outputMint: string;
  userPublicKey: string | null;
}): string | null {
  return getCoreJupiterSwapFeeEstimateFlowKey({
    ...params,
    baseUrl: JUPITER_SWAP_API_BASE_URL,
  });
}
