const JUPITER_QUOTE_API_URL = "https://api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_API_URL = "https://api.jup.ag/swap/v1/swap";

export type JupiterQuoteResponse = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: unknown[];
};

export async function getJupiterQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
}): Promise<JupiterQuoteResponse> {
  const url = new URL(JUPITER_QUOTE_API_URL);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amount);
  url.searchParams.set("slippageBps", String(params.slippageBps ?? 50));

  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`Jupiter quote failed: ${resp.status}`);
  return resp.json();
}

export async function getJupiterSwapTransaction(params: {
  quoteResponse: JupiterQuoteResponse;
  userPublicKey: string;
}): Promise<{ swapTransaction: string }> {
  const resp = await fetch(JUPITER_SWAP_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: true,
    }),
  });
  if (!resp.ok) throw new Error(`Jupiter swap failed: ${resp.status}`);
  return resp.json();
}
