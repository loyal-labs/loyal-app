import "server-only";

import { fetchJson } from "../core/http";
import { JUPITER_TOKENS_V2_BASE_URL, TOKEN_DATA_ERRORS } from "./constants";
import type { JupiterTokenMetrics, JupiterTokenSearchResult } from "./types";

function mapTokenMetrics(token: JupiterTokenSearchResult): JupiterTokenMetrics {
  return {
    fdvUsd: token.fdv,
    holderCount: token.holderCount,
    liquidityUsd: token.liquidity,
    marketCapUsd: token.mcap,
    priceUsd: token.usdPrice,
    updatedAt: token.updatedAt,
  };
}

export async function fetchTokenMetricsByMint(
  mint: string
): Promise<JupiterTokenMetrics> {
  const params = new URLSearchParams({ query: mint });
  const url = `${JUPITER_TOKENS_V2_BASE_URL}/search?${params.toString()}`;

  const response = await fetchJson<JupiterTokenSearchResult[]>(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const token = response.find((item) => item.id === mint);
  if (!token) {
    throw new Error(TOKEN_DATA_ERRORS.INVALID_RESPONSE);
  }

  if (!Number.isFinite(token.usdPrice) || !Number.isFinite(token.mcap)) {
    throw new Error(TOKEN_DATA_ERRORS.INVALID_RESPONSE);
  }

  return mapTokenMetrics(token);
}
