import {
  estimateJupiterSwapFeeState as estimateCoreJupiterSwapFeeState,
  getJupiterQuote as getCoreJupiterQuote,
  getJupiterSwapInstructions as getCoreJupiterSwapInstructions,
  getJupiterSwapTransaction as getCoreJupiterSwapTransaction,
  type JupiterQuoteResponse,
  type JupiterSwapInstructionsResponse,
  type JupiterSwapResponse,
  type SwapFeeEstimate,
  type SwapFeeEstimateConnection,
  type SwapFeeEstimateState,
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
}): Promise<SwapFeeEstimateState> {
  return estimateCoreJupiterSwapFeeState({
    ...params,
    baseUrl: JUPITER_SWAP_API_BASE_URL,
  });
}
