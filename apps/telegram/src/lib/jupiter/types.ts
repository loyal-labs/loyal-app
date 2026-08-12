/** GET /ultra/v1/order query params */
export type JupiterOrderRequest = {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker: string;
};

/** Shared fields across aggregator and RFQ order responses */
type JupiterOrderBase = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: "ExactIn";
  slippageBps: number;
  priceImpactPct: string;
  feeBps: number;
  transaction: string;
  requestId: string;
  gasless: boolean;
  signatureFeeLamports: number;
  prioritizationFeeLamports: number;
  rentFeeLamports: number;
  inUsdValue: number;
  outUsdValue: number;
  swapUsdValue: number;
  totalTime: number;
};

export type JupiterOrderResponse = JupiterOrderBase & {
  swapType: "aggregator" | "rfq";
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
};

export type JupiterOrderErrorResponse = {
  error: string;
  code?: number;
};

export type JupiterTokenSearchResult = {
  id: string;
  name: string;
  symbol: string;
  usdPrice: number;
  mcap: number;
  fdv?: number;
  holderCount?: number;
  liquidity?: number;
  updatedAt?: string;
};

export type JupiterTokenMetrics = {
  priceUsd: number;
  marketCapUsd: number;
  fdvUsd?: number;
  holderCount?: number;
  liquidityUsd?: number;
  updatedAt?: string;
};

/** POST /ultra/v1/execute request */
export type JupiterExecuteRequest = {
  signedTransaction: string;
  requestId: string;
};

/** POST /ultra/v1/execute success response */
export type JupiterExecuteResponse = {
  status: "Success" | "Failed";
  signature: string;
  slot: string;
  code: number;
  inputAmountResult?: string;
  outputAmountResult?: string;
  swapEvents?: Array<{
    inputMint: string;
    inputAmount: string;
    outputMint: string;
    outputAmount: string;
  }>;
  error?: string;
};

/** Params passed from UI to useSwap hook */
export type SwapParams = {
  fromMint: string;
  toMint: string;
  fromAmount: number;
  fromDecimals: number;
  toDecimals: number;
  fromSymbol: string;
  toSymbol: string;
};

/** Result returned from useSwap hook to UI */
export type SwapResult = {
  success: boolean;
  signature?: string;
  fromAmount?: number;
  fromSymbol?: string;
  toAmount?: number;
  toSymbol?: string;
  error?: string;
};
