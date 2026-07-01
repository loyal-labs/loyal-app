export type JupiterQuoteResponse = {
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

export type JupiterSwapResponse = {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
};

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
