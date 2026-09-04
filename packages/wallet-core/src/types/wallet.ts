export type RightSidebarTab =
  | "portfolio"
  | "receive"
  | "send"
  | "swap"
  | "sign-in"
  | "connect";

export interface TokenRow {
  id?: string;
  symbol: string;
  name?: string;
  price: string;
  amount: string;
  value: string;
  icon: string;
  priceChange24h?: number | null;
  totalAmountDisplay?: string | null;
  totalValueDisplay?: string | null;
  publicAmountDisplay?: string | null;
  publicValueDisplay?: string | null;
  /** USD value earned since principal was recorded (formatted, signed). */
  earnedValueDisplay?: string | null;
  /** USD value of principal (formatted) — shown next to earned delta. */
  principalValueDisplay?: string | null;
}

export interface ActivityRow {
  id: string;
  type: "received" | "sent";
  counterparty: string;
  amount: string;
  timestamp: string;
  date: string;
  icon: string;
  /** Epoch milliseconds for sort order — absent in legacy localStorage rows */
  rawTimestamp?: number;
  /** Replaces the type-derived row title (e.g. "Earn Deposit"). */
  titleOverride?: string;
  /** Replaces the default "to/from <counterparty>" subtitle (e.g. "Network fee"). */
  subtitle?: string;
}

export interface TransactionDetail {
  activity: ActivityRow;
  usdValue: string;
  status: string;
  networkFee: string;
  networkFeeUsd: string;
}

export interface SwapToken {
  mint?: string;
  symbol: string;
  icon: string;
  price: number;
  balance: number;
}

export type SwapMode = "swap";

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
  | {
      type: "transaction";
      detail: TransactionDetail;
      from: "portfolio" | "allActivity";
    }
  | { type: "tokenSelect"; field: "from" | "to" }
  | { type: "sendTokenSelect" }
  | { type: "approvalReview" }
  | { type: "accountPage"; account: "main" | "vault" }
  | {
      type: "agentPage";
      agentId: string;
      label: string;
      agentIcon?: string;
      balanceWhole: string;
      balanceFraction: string;
    }
  | {
      type: "stashPage";
      label: string;
      balanceWhole: string;
      balanceFraction: string;
    }
  | { type: "sendPanel"; source?: "main" | "vault"; mint?: string }
  | { type: "receivePanel" }
  | { type: "swapPanel"; mode?: "swap" }
  | { type: "dappConnect"; origin: string; favicon?: string; requestId: string }
  | {
      type: "dappSign";
      origin: string;
      favicon?: string;
      requestId: string;
      kind: "signTransaction" | "signMessage";
      transactionBase64?: string;
      messageBase64?: string;
    }
  | { type: "tokenDetail"; token: TokenRow; from: "portfolio" | "allTokens" };

export const LOYL_TOKEN: SwapToken = {
  mint: "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta",
  symbol: "LOYAL",
  icon: "https://avatars.githubusercontent.com/u/210601628?s=200&v=4",
  price: 0,
  balance: 0,
};
