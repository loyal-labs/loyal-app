export const JUPITER_API_BASE_URL = "https://api.jup.ag";
export const JUPITER_LITE_API_BASE_URL = "https://lite-api.jup.ag";
export const JUPITER_TOKENS_V2_BASE_URL = `${JUPITER_LITE_API_BASE_URL}/tokens/v2`;

/** Jupiter V6 Aggregator program — used for deterministic on-chain swap detection */
export const JUPITER_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

export const COMMON_MINTS = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
} as const;

export const SWAP_ERRORS = {
  QUOTE_FAILED: "Failed to get swap quote. Please try again.",
  INSUFFICIENT_LIQUIDITY: "Insufficient liquidity for this swap.",
  PRICE_IMPACT_HIGH: "Price impact is too high for this swap.",
  TRANSACTION_FAILED: "Transaction failed. Please try again.",
  SIGNING_FAILED: "Failed to sign transaction.",
  CONFIRMATION_TIMEOUT: "Transaction confirmation timed out.",
  INVALID_RESPONSE: "Invalid response from swap API.",
  MISSING_API_KEY: "Swap service is not configured.",
  ORDER_EXPIRED: "Swap order expired. Please try again.",
  EXECUTION_FAILED: "Swap execution failed. Please try again.",
} as const;

export const TOKEN_DATA_ERRORS = {
  INVALID_RESPONSE: "Invalid Jupiter token response.",
} as const;
