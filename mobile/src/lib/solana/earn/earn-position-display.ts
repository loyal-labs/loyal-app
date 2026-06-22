import {
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDC_MINT_MAINNET,
  SOLANA_USDT_MINT_MAINNET,
} from "@/lib/solana/constants";

// Kamino lending-market pubkeys (base58). Ported from `@loyal-labs/loyal-actions`
// — mobile doesn't depend on that package, so the handful of markets the Earn
// vault can hold are inlined here. Keep in sync with the web's source of truth
// `frontend/src/lib/yield-optimization/earn-position-display.ts`.
const KAMINO_MAIN_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
const KAMINO_DEVNET_MAIN_MARKET = "27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J";
const KAMINO_FIGURE_MARKET = "CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA";
const KAMINO_MAPLE_MARKET = "6WEGfej9B9wjxRs6t4BYpb9iCXd8CpTpJ8fVSNzHCC5y";
const KAMINO_ONRE_MARKET = "47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8";
const KAMINO_ETHENA_MARKET = "BJnbcRHqvppTyGesLzWASGKnmnF1wq9jZu6ExrjT7wvF";
const KAMINO_JLP_MARKET = "DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek";
const KAMINO_BITCOIN_MARKET = "GMqmFygF5iSm5nkckYU6tieggFcR42SyjkkhK5rswFRs";
const KAMINO_SUPERSTATE_OPENING_BELL_MARKET =
  "CF32kn7AY8X1bW7ZkGcHc4X9ZWTxqKGCJk6QwrQkDcdw";
const KAMINO_HUMA_MARKET = "52FSGeeokLpgvgAMdqxyt5Hoc2TbUYj5b8yxrEdZ37Vf";
const KAMINO_SOLSTICE_MARKET = "9Y7uwXgQ68mGqRtZfuFaP4hc4fxeJ7cE9zTtqTxVhfGU";

// Markets that ship a dedicated brand badge; every other Kamino market falls
// back to the Kamino mark (`venue: "kamino"`).
export type EarnVenueKey = "kamino" | "prime" | "maple" | "onre" | "ethena";

const MARKET_NAMES: Record<string, string> = {
  [KAMINO_MAIN_MARKET]: "Main Kamino",
  [KAMINO_DEVNET_MAIN_MARKET]: "Main Kamino",
  [KAMINO_FIGURE_MARKET]: "Prime Market",
  [KAMINO_MAPLE_MARKET]: "Maple Market",
  [KAMINO_ONRE_MARKET]: "OnRe Market",
  [KAMINO_ETHENA_MARKET]: "Ethena Market",
  [KAMINO_JLP_MARKET]: "JLP Market",
  [KAMINO_BITCOIN_MARKET]: "Bitcoin Market",
  [KAMINO_SUPERSTATE_OPENING_BELL_MARKET]: "Superstate Market",
  [KAMINO_HUMA_MARKET]: "Huma Market",
  [KAMINO_SOLSTICE_MARKET]: "Solstice Market",
};

const MARKET_VENUES: Record<string, EarnVenueKey> = {
  [KAMINO_FIGURE_MARKET]: "prime",
  [KAMINO_MAPLE_MARKET]: "maple",
  [KAMINO_ONRE_MARKET]: "onre",
  [KAMINO_ETHENA_MARKET]: "ethena",
};

const MINT_SYMBOLS: Record<string, string> = {
  [SOLANA_USDC_MINT_MAINNET]: "USDC",
  [SOLANA_USDC_MINT_DEVNET]: "USDC",
  [SOLANA_USDT_MINT_MAINNET]: "USDT",
};

function shortenAddress(address: string): string {
  return address.length <= 10
    ? address
    : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export type EarnPositionDisplay = {
  marketName: string;
  mintSymbol: string;
  venue: EarnVenueKey;
};

// Maps a withdrawal source / position (Kamino market pubkey + liquidity mint) to
// its display fields. `market` is null for idle vault balances — the undeployed
// cash still sitting in the Kamino-backed Earn vault.
export function resolveEarnPositionDisplay(args: {
  market: string | null;
  liquidityMint: string;
}): EarnPositionDisplay {
  const mintSymbol =
    MINT_SYMBOLS[args.liquidityMint] ?? shortenAddress(args.liquidityMint);

  if (!args.market) {
    return { marketName: "Idle balance", mintSymbol, venue: "kamino" };
  }

  return {
    marketName: MARKET_NAMES[args.market] ?? shortenAddress(args.market),
    mintSymbol,
    venue: MARKET_VENUES[args.market] ?? "kamino",
  };
}
