export type RightSidebarTab = "portfolio" | "receive" | "send" | "swap" | "sign-in";

export interface TokenRow {
  id?: string;
  symbol: string;
  price: string;
  amount: string;
  value: string;
  icon: string;
  isSecured?: boolean;
  /** Supply APY in basis points (e.g. 565 = 5.65%) — shown as badge when set. */
  apyBps?: number | null;
  /** USD value earned since principal was recorded (formatted, signed). */
  earnedValueDisplay?: string | null;
  /** USD value of principal (formatted) — shown next to earned delta. */
  principalValueDisplay?: string | null;
}

export interface ActivityRow {
  id: string;
  type: "received" | "sent" | "shielded" | "unshielded";
  counterparty: string;
  amount: string;
  timestamp: string;
  date: string;
  icon: string;
  isPrivate?: boolean;
  /** Epoch milliseconds for sort order — absent in legacy localStorage rows */
  rawTimestamp?: number;
}

export interface TransactionDetail {
  activity: ActivityRow;
  usdValue: string;
  status: string;
  networkFee: string;
  networkFeeUsd: string;
  isPrivate?: boolean;
}

export interface SwapToken {
  mint?: string;
  symbol: string;
  icon: string;
  price: number;
  balance: number;
}

export type SwapMode = "swap" | "shield";

export interface FormButtonProps {
  label: string;
  disabled: boolean;
  onClick: () => void;
}

export type SubView =
  | null
  | "allTokens"
  | "allActivity"
  | { type: "transaction"; detail: TransactionDetail; from: "portfolio" | "allActivity" }
  | { type: "tokenSelect"; field: "from" | "to" }
  | { type: "sendTokenSelect" }
  | { type: "shieldTokenSelect" };

export const LOYL_TOKEN: SwapToken = {
  mint: "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta",
  symbol: "LOYAL",
  icon: "https://avatars.githubusercontent.com/u/210601628?s=200&v=4",
  price: 0,
  balance: 0,
};
