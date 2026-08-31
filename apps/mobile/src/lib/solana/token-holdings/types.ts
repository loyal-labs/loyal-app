export type TokenHolding = {
  mint: string;
  symbol: string;
  name: string;
  balance: number;
  decimals: number;
  priceUsd: number | null;
  valueUsd: number | null;
  imageUrl: string | null;
};

export type HeliusAsset = {
  id: string;
  interface: string;
  token_info?: {
    symbol: string;
    balance: number;
    decimals: number;
    price_info?: {
      price_per_token: number;
      total_price: number;
    };
  };
  content?: {
    metadata?: {
      name: string;
      symbol: string;
    };
    links?: {
      image?: string;
    };
  };
};

export type HeliusNativeBalance = {
  lamports: number;
  price_per_sol?: number;
  total_price?: number;
};

export type HeliusResponse = {
  jsonrpc: "2.0";
  result: {
    items: HeliusAsset[];
    nativeBalance?: HeliusNativeBalance;
  };
  id: string;
};

export type CachedHoldings = {
  holdings: TokenHolding[];
  fetchedAt: number;
};
