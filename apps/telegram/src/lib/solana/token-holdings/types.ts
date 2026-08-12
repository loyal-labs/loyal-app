export type TokenHolding = {
  mint: string;
  symbol: string;
  name: string;
  balance: number;
  decimals: number;
  priceUsd: number | null;
  valueUsd: number | null;
  imageUrl: string | null;
  isSecured?: boolean;
  principalBalance?: number | null;
  earnedBalance?: number | null;
  earnedValueUsd?: number | null;
};
