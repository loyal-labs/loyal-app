import { PublicKey } from "@solana/web3.js";
import { MaxFeeBps, RiskBasket, Stablecoin } from "./types.js";
import type { Address } from "./types.js";

export const DEFAULT_MAX_FEE_BPS = MaxFeeBps.Bps100;

export const STABLECOIN_MINTS: Record<Stablecoin, Address> = {
  [Stablecoin.USDC]: new PublicKey(
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  ),
  [Stablecoin.USDT]: new PublicKey(
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
  ),
  [Stablecoin.PYUSD]: new PublicKey(
    "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"
  ),
  [Stablecoin.USDS]: new PublicKey(
    "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA"
  ),
  [Stablecoin.USDG]: new PublicKey(
    "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH"
  ),
  [Stablecoin.USDE]: new PublicKey(
    "DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT"
  ),
  [Stablecoin.SUSDE]: new PublicKey(
    "Eh6XEPhSwoLv5wFApukmnaVSHQ6sAnoD9BmgmwQoN2sN"
  ),
};

export const STABLECOINS = [
  Stablecoin.USDC,
  Stablecoin.USDT,
  Stablecoin.PYUSD,
  Stablecoin.USDS,
  Stablecoin.USDG,
  Stablecoin.USDE,
  Stablecoin.SUSDE,
] as const;

export const KAMINO_MAIN_MARKET = new PublicKey(
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"
);
export const KAMINO_FIGURE_MARKET = new PublicKey(
  "CqAoLuqWtavaVE8deBjMKe8ZfSt9ghR6Vb8nfsyabyHA"
);
export const KAMINO_MAPLE_MARKET = new PublicKey(
  "6WEGfej9B9wjxRs6t4BYpb9iCXd8CpTpJ8fVSNzHCC5y"
);
export const KAMINO_ONRE_MARKET = new PublicKey(
  "47tfyEG9SsdEnUm9cw5kY9BXngQGqu3LBoop9j5uTAv8"
);
export const KAMINO_ETHENA_MARKET = new PublicKey(
  "BJnbcRHqvppTyGesLzWASGKnmnF1wq9jZu6ExrjT7wvF"
);
export const KAMINO_JLP_MARKET = new PublicKey(
  "DxXdAyU3kCjnyggvHmY5nAwg5cRbbmdyX3npfDMjjMek"
);
export const KAMINO_BITCOIN_MARKET = new PublicKey(
  "GMqmFygF5iSm5nkckYU6tieggFcR42SyjkkhK5rswFRs"
);
export const KAMINO_SUPERSTATE_OPENING_BELL_MARKET = new PublicKey(
  "CF32kn7AY8X1bW7ZkGcHc4X9ZWTxqKGCJk6QwrQkDcdw"
);
export const KAMINO_HUMA_MARKET = new PublicKey(
  "52FSGeeokLpgvgAMdqxyt5Hoc2TbUYj5b8yxrEdZ37Vf"
);
export const KAMINO_SOLSTICE_MARKET = new PublicKey(
  "9Y7uwXgQ68mGqRtZfuFaP4hc4fxeJ7cE9zTtqTxVhfGU"
);
export const KAMINO_XSTOCKS_MARKET = new PublicKey(
  "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua"
);
export const KAMINO_ALTCOINS_MARKET = new PublicKey(
  "ByYiZxp8QrdN9qbdtaAiePN8AAr3qvTPppNJDpf5DVJ5"
);

const safeMarkets = [
  KAMINO_MAIN_MARKET,
  KAMINO_FIGURE_MARKET,
  KAMINO_MAPLE_MARKET,
  KAMINO_ONRE_MARKET,
  KAMINO_ETHENA_MARKET,
] as const;

const mediumMarkets = [
  ...safeMarkets,
  KAMINO_JLP_MARKET,
  KAMINO_BITCOIN_MARKET,
  KAMINO_SUPERSTATE_OPENING_BELL_MARKET,
] as const;

export const RISK_BASKET_MARKETS: Record<RiskBasket, readonly Address[]> = {
  [RiskBasket.Safe]: safeMarkets,
  [RiskBasket.Medium]: mediumMarkets,
  [RiskBasket.Aggressive]: [
    ...mediumMarkets,
    KAMINO_HUMA_MARKET,
    KAMINO_SOLSTICE_MARKET,
    KAMINO_XSTOCKS_MARKET,
    KAMINO_ALTCOINS_MARKET,
  ],
};

export const KAMINO_LEND_PROGRAM_ID = new PublicKey(
  "KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd"
);
export const KAMINO_DEPOSIT_RESERVE_LIQUIDITY_DISCRIMINATOR = [
  242, 35, 198, 137, 82, 225, 242, 182,
] as const;
export const KAMINO_WITHDRAW_RESERVE_LIQUIDITY_DISCRIMINATOR = [
  235, 52, 119, 152, 149, 197, 20, 7,
] as const;

export const JUPITER_SWAP_DISCRIMINATOR = [
  187, 100, 250, 204, 49, 196, 175, 20,
] as const;
export const JUPITER_SWAP_SLIPPAGE_BPS_OFFSET = 24;

export const YIELD_ROUTE_STANDALONE_ACTION_SEED = BigInt(1);
