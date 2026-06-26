import { PublicKey } from "@solana/web3.js";
import { LoyalCluster, MaxFeeBps, RiskBasket, Stablecoin } from "./types.ts";
import type { Address } from "./types.ts";

export const DEFAULT_MAX_FEE_BPS = MaxFeeBps.Bps100;

export const STABLECOIN_MINTS: Record<Stablecoin, Address> = {
  [Stablecoin.CASH]: new PublicKey(
    "CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH"
  ),
  [Stablecoin.USDG]: new PublicKey(
    "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH"
  ),
  [Stablecoin.PYUSD]: new PublicKey(
    "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"
  ),
  [Stablecoin.USDC]: new PublicKey(
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  ),
  [Stablecoin.USDT]: new PublicKey(
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
  ),
  [Stablecoin.USDS]: new PublicKey(
    "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA"
  ),
};

export const STABLECOIN_MINTS_BY_CLUSTER: Record<
  LoyalCluster,
  Partial<Record<Stablecoin, Address>>
> = {
  [LoyalCluster.MainnetBeta]: STABLECOIN_MINTS,
  [LoyalCluster.Devnet]: {
    [Stablecoin.USDC]: new PublicKey(
      "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
    ),
  },
};

export const STABLECOINS = [
  Stablecoin.CASH,
  Stablecoin.USDG,
  Stablecoin.PYUSD,
  Stablecoin.USDC,
  Stablecoin.USDT,
  Stablecoin.USDS,
] as const;

export const KAMINO_MAIN_MARKET = new PublicKey(
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"
);
export const KAMINO_MAIN_USDC_RESERVE = new PublicKey(
  "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59"
);
export const KAMINO_DEVNET_MAIN_MARKET = new PublicKey(
  "27MKCQo5qP7ijrwWSMKX2Jeb3PhK2NZmHQ9befWVRS4J"
);
export const KAMINO_DEVNET_USDC_RESERVE = new PublicKey(
  "9uKMtFU9UJ9DfbwzCReGENb31appi79KTEeDGdCnvMjy"
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

export const RISK_BASKET_MARKETS_BY_CLUSTER: Record<
  LoyalCluster,
  Record<RiskBasket, readonly Address[]>
> = {
  [LoyalCluster.MainnetBeta]: RISK_BASKET_MARKETS,
  [LoyalCluster.Devnet]: {
    [RiskBasket.Safe]: [KAMINO_DEVNET_MAIN_MARKET],
    [RiskBasket.Medium]: [KAMINO_DEVNET_MAIN_MARKET],
    [RiskBasket.Aggressive]: [KAMINO_DEVNET_MAIN_MARKET],
  },
};

export function getStablecoinMintForCluster(
  cluster: LoyalCluster,
  stablecoin: Stablecoin
): Address {
  const mint = STABLECOIN_MINTS_BY_CLUSTER[cluster]?.[stablecoin];
  if (!mint) {
    throw new Error(
      `unsupported stablecoin ${stablecoin} for cluster ${cluster}`
    );
  }
  return mint;
}

export function getStablecoinMintsForCluster(
  cluster: LoyalCluster
): readonly Address[] {
  return STABLECOINS.flatMap((stablecoin) => {
    const mint = STABLECOIN_MINTS_BY_CLUSTER[cluster]?.[stablecoin];
    return mint ? [mint] : [];
  });
}

export function getStablecoinsForCluster(
  cluster: LoyalCluster
): readonly Stablecoin[] {
  return STABLECOINS.filter(
    (stablecoin) => STABLECOIN_MINTS_BY_CLUSTER[cluster]?.[stablecoin]
  );
}

export function getRiskBasketMarketsForCluster(
  cluster: LoyalCluster,
  risk: RiskBasket
): readonly Address[] {
  return RISK_BASKET_MARKETS_BY_CLUSTER[cluster][risk];
}

export function getKaminoUsdcEarnTargetForCluster(cluster: LoyalCluster): {
  depositDiscriminator: readonly number[];
  initObligationDiscriminator: readonly number[];
  liquidityMint: Address;
  lendProgramId: Address;
  market: Address;
  reserve: Address;
  withdrawDiscriminator: readonly number[];
} {
  if (cluster === LoyalCluster.Devnet) {
    return {
      depositDiscriminator:
        KAMINO_DEVNET_DEPOSIT_RESERVE_LIQUIDITY_DISCRIMINATOR,
      initObligationDiscriminator: KAMINO_INIT_OBLIGATION_DISCRIMINATOR,
      liquidityMint: getStablecoinMintForCluster(cluster, Stablecoin.USDC),
      lendProgramId: KAMINO_DEVNET_LEND_PROGRAM_ID,
      market: KAMINO_DEVNET_MAIN_MARKET,
      reserve: KAMINO_DEVNET_USDC_RESERVE,
      withdrawDiscriminator:
        KAMINO_DEVNET_WITHDRAW_RESERVE_LIQUIDITY_DISCRIMINATOR,
    };
  }

  return {
    depositDiscriminator: KAMINO_DEPOSIT_RESERVE_LIQUIDITY_DISCRIMINATOR,
    initObligationDiscriminator: KAMINO_INIT_OBLIGATION_DISCRIMINATOR,
    liquidityMint: getStablecoinMintForCluster(cluster, Stablecoin.USDC),
    lendProgramId: KAMINO_LEND_PROGRAM_ID,
    market: KAMINO_MAIN_MARKET,
    reserve: KAMINO_MAIN_USDC_RESERVE,
    withdrawDiscriminator: KAMINO_WITHDRAW_RESERVE_LIQUIDITY_DISCRIMINATOR,
  };
}

export const KAMINO_LEND_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);
export const KAMINO_DEVNET_LEND_PROGRAM_ID = new PublicKey(
  "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"
);
export const KAMINO_DEPOSIT_RESERVE_LIQUIDITY_DISCRIMINATOR = [
  216, 224, 191, 27, 204, 151, 102, 175,
] as const;
export const KAMINO_WITHDRAW_RESERVE_LIQUIDITY_DISCRIMINATOR = [
  235, 52, 119, 152, 149, 197, 20, 7,
] as const;
export const KAMINO_DEVNET_DEPOSIT_RESERVE_LIQUIDITY_DISCRIMINATOR = [
  169, 201, 30, 126, 6, 205, 102, 68,
] as const;
export const KAMINO_DEVNET_WITHDRAW_RESERVE_LIQUIDITY_DISCRIMINATOR = [
  234, 117, 181, 125, 185, 142, 220, 29,
] as const;
export const KAMINO_INIT_OBLIGATION_DISCRIMINATOR = [
  251, 10, 231, 76, 27, 11, 159, 96,
] as const;
export const KAMINO_VANILLA_OBLIGATION_TAG = 0;
export const KAMINO_VANILLA_OBLIGATION_ID = 0;
export const KAMINO_USER_METADATA_SEED = new TextEncoder().encode("user_meta");

export const JUPITER_SWAP_DISCRIMINATOR = [
  187, 100, 250, 204, 49, 196, 175, 20,
] as const;
export const JUPITER_SWAP_SLIPPAGE_BPS_OFFSET = 24;

export const YIELD_ROUTE_STANDALONE_ACTION_SEED = BigInt(1);

export const SUBSCRIPTIONS_PROGRAM_ID = new PublicKey(
  "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44"
);
export const SUBSCRIPTIONS_INIT_AUTHORITY = 0;
export const SUBSCRIPTIONS_CREATE_RECURRING_DELEGATION = 2;
export const SUBSCRIPTIONS_REVOKE_DELEGATION = 3;
export const SUBSCRIPTIONS_TRANSFER_RECURRING = 5;
export const SUBSCRIPTION_AUTHORITY_SEED = new TextEncoder().encode(
  "SubscriptionAuthority"
);
export const SUBSCRIPTION_DELEGATION_SEED = new TextEncoder().encode(
  "delegation"
);
export const SUBSCRIPTION_EVENT_AUTHORITY_SEED = new TextEncoder().encode(
  "event_authority"
);
export const SUBSCRIPTION_TRANSFER_AMOUNT_OFFSET = 1;
export const SUBSCRIPTION_TRANSFER_DELEGATOR_OFFSET = 9;
export const SUBSCRIPTION_TRANSFER_MINT_OFFSET = 41;
export const SUBSCRIPTION_AUTHORITY_DATA_LEN = 106;
export const SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR = 3;
export const SUBSCRIPTION_RECURRING_DELEGATION_DATA_LEN = 211;
export const SUBSCRIPTION_RECURRING_DELEGATION_DISCRIMINATOR_OFFSET = 0;
export const SUBSCRIPTION_RECURRING_DELEGATION_DELEGATOR_OFFSET = 3;
export const SUBSCRIPTION_RECURRING_DELEGATION_DELEGATEE_OFFSET = 35;
export const SUBSCRIPTION_RECURRING_DELEGATION_AUTHORITY_OFFSET = 107;
export const SUBSCRIPTION_RECURRING_DELEGATION_MINT_OFFSET = 139;
export const SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PER_PERIOD_OFFSET = 195;
export const SUBSCRIPTION_RECURRING_DELEGATION_AMOUNT_PULLED_OFFSET = 203;
