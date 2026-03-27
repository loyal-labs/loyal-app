export type RightSidebarTab = "portfolio" | "receive" | "send" | "swap" | "sign-in" | "connect";

export interface TokenRow {
  id?: string;
  symbol: string;
  price: string;
  amount: string;
  value: string;
  icon: string;
  isSecured?: boolean;
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
  | "allApprovals"
  | { type: "transaction"; detail: TransactionDetail; from: "portfolio" | "allActivity" }
  | { type: "tokenSelect"; field: "from" | "to" }
  | { type: "sendTokenSelect" }
  | { type: "shieldTokenSelect" }
  | { type: "approvalReview" }
  | { type: "accountPage"; account: "main" | "vault" }
  | { type: "agentPage"; agentId: string; label: string; agentIcon?: string; balanceWhole: string; balanceFraction: string }
  | { type: "stashPage"; label: string; balanceWhole: string; balanceFraction: string }
  | { type: "sendPanel" }
  | { type: "receivePanel" }
  | { type: "swapPanel"; mode?: "swap" | "shield" }
  | { type: "dappConnect"; origin: string; favicon?: string; requestId: string }
  | { type: "dappSign"; origin: string; favicon?: string; requestId: string; kind: "signTransaction" | "signMessage" };

export const LOYL_TOKEN: SwapToken = {
  mint: "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta",
  symbol: "LOYAL",
  icon: "https://avatars.githubusercontent.com/u/210601628?s=200&v=4",
  price: 0,
  balance: 0,
};
