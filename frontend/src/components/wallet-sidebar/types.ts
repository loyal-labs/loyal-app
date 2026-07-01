import { getTokenIconUrl } from "@/lib/token-icon";

export type {
  ActivityRow,
  FormButtonProps,
  RightSidebarTab,
  SubView,
  SwapMode,
  SwapToken,
  TokenRow,
  TransactionDetail,
} from "@loyal-labs/wallet-core/types";

export { LOYL_TOKEN } from "@loyal-labs/wallet-core/types";
export type { SwapToken as SwapTokenType } from "@loyal-labs/wallet-core/types";

import type { SwapToken } from "@loyal-labs/wallet-core/types";

export const swapTokens: SwapToken[] = [
  {
    symbol: "USDC",
    icon: getTokenIconUrl("USDC"),
    price: 0.9997,
    balance: 16285,
  },
  {
    symbol: "SOL",
    icon: getTokenIconUrl("SOL"),
    price: 99.03,
    balance: 14.98765,
  },
  { symbol: "USDT", icon: getTokenIconUrl("USDT"), price: 0.99, balance: 1267 },
  { symbol: "BNB", icon: getTokenIconUrl("BNB"), price: 559.06, balance: 0 },
  {
    symbol: "WBTC",
    icon: getTokenIconUrl("WBTC"),
    price: 76375.83,
    balance: 0,
  },
];
