import "server-only";

import { serverEnv } from "../core/config/server";
import { fetchJson } from "../core/http";
import { JUPITER_API_BASE_URL, SWAP_ERRORS } from "./constants";
import type {
  JupiterExecuteRequest,
  JupiterExecuteResponse,
  JupiterOrderRequest,
  JupiterOrderResponse,
} from "./types";

function getApiKey(): string {
  try {
    return serverEnv.jupiterApiKey;
  } catch {
    throw new Error(SWAP_ERRORS.MISSING_API_KEY);
  }
}

function buildHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-api-key": getApiKey(),
  };
}

export async function fetchOrder(
  request: JupiterOrderRequest
): Promise<JupiterOrderResponse> {
  const params = new URLSearchParams({
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    amount: request.amount,
    taker: request.taker,
  });

  const url = `${JUPITER_API_BASE_URL}/ultra/v1/order?${params.toString()}`;

  return fetchJson<JupiterOrderResponse>(url, {
    method: "GET",
    headers: buildHeaders(),
  });
}

export async function executeOrder(
  request: JupiterExecuteRequest
): Promise<JupiterExecuteResponse> {
  const url = `${JUPITER_API_BASE_URL}/ultra/v1/execute`;

  return fetchJson<JupiterExecuteResponse>(url, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(request),
  });
}
