import { VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";

import type {
  JupiterQuoteResponse,
  JupiterSwapInstructionsResponse,
  JupiterSwapResponse,
} from "./types";

const DEFAULT_JUPITER_SWAP_API_BASE_URL = "https://lite-api.jup.ag/swap/v1";

const buildJupiterHeaders = (
  apiKey?: string,
  extra?: Record<string, string>
): Record<string, string> => ({
  ...(extra ?? {}),
  ...(apiKey ? { "x-api-key": apiKey } : {}),
});

const normalizeBaseUrl = (baseUrl?: string): string =>
  (baseUrl || DEFAULT_JUPITER_SWAP_API_BASE_URL).replace(/\/+$/, "");

const buildJupiterUrl = (baseUrl: string | undefined, path: string): string =>
  `${normalizeBaseUrl(baseUrl)}/${path.replace(/^\/+/, "")}`;

const fetchJson = async <T>(
  url: string,
  init?: RequestInit,
  fetchFn: typeof fetch = fetch
): Promise<T> => {
  const response = await fetchFn(url, init);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Jupiter API failed: ${response.statusText} - ${errorText}`
    );
  }

  return response.json() as Promise<T>;
};

const decodeBase64 = (value: string): Uint8Array => {
  return new Uint8Array(Buffer.from(value, "base64"));
};

export { DEFAULT_JUPITER_SWAP_API_BASE_URL };

export interface JupiterQuoteParams {
  inputMint: string;
  outputMint: string;
  amount: string; // in smallest unit (lamports etc.)
  slippageBps?: number;
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

export async function getJupiterQuote(
  params: JupiterQuoteParams
): Promise<JupiterQuoteResponse> {
  const {
    inputMint,
    outputMint,
    amount,
    slippageBps = 50,
    apiKey,
    baseUrl,
    fetchFn,
    signal,
  } = params;

  const url = new URL(buildJupiterUrl(baseUrl, "quote"));
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amount);
  url.searchParams.set("slippageBps", String(slippageBps));

  return fetchJson<JupiterQuoteResponse>(
    url.toString(),
    {
      headers: buildJupiterHeaders(apiKey),
      signal,
    },
    fetchFn
  );
}

export interface JupiterSwapParams {
  userPublicKey: string;
  quoteResponse: JupiterQuoteResponse;
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
  wrapAndUnwrapSol?: boolean;
  dynamicComputeUnitLimit?: boolean;
  priorityLevel?: string;
  maxPriorityFeeLamports?: number;
}

const buildSwapRequestBody = (params: JupiterSwapParams) => {
  const {
    userPublicKey,
    quoteResponse,
    wrapAndUnwrapSol = true,
    dynamicComputeUnitLimit = true,
    priorityLevel = "veryHigh",
    maxPriorityFeeLamports = 50_000_000,
  } = params;

  return {
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
  };
};

export async function getJupiterSwapTransaction(
  params: JupiterSwapParams
): Promise<JupiterSwapResponse> {
  return fetchJson<JupiterSwapResponse>(
    buildJupiterUrl(params.baseUrl, "swap"),
    {
      method: "POST",
      headers: buildJupiterHeaders(params.apiKey, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(buildSwapRequestBody(params)),
      signal: params.signal,
    },
    params.fetchFn
  );
}

export async function executeJupiterSwap(
  params: JupiterSwapParams
): Promise<JupiterSwapResponse> {
  return getJupiterSwapTransaction(params);
}

export async function getJupiterSwapInstructions(
  params: JupiterSwapParams
): Promise<JupiterSwapInstructionsResponse> {
  return fetchJson<JupiterSwapInstructionsResponse>(
    buildJupiterUrl(params.baseUrl, "swap-instructions"),
    {
      method: "POST",
      headers: buildJupiterHeaders(params.apiKey, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(buildSwapRequestBody(params)),
      signal: params.signal,
    },
    params.fetchFn
  );
}

export function deserializeJupiterSwapTransaction(
  swapTransaction: string
): VersionedTransaction {
  return VersionedTransaction.deserialize(decodeBase64(swapTransaction));
}
