import type { WalletTransfer } from "@/lib/solana/rpc/types";

export type TransactionType = "incoming" | "outgoing" | "pending";

export type TransactionStatus = "pending" | "completed" | "error";

export type Transaction = {
  id: string;
  type: TransactionType;
  amountLamports: number;
  status?: TransactionStatus;
  networkFeeLamports?: number;
  signature?: string;
  transferType?: WalletTransfer["type"];
  // Optional SPL token transfer fields
  tokenMint?: string;
  tokenAmount?: string;
  tokenDecimals?: number;
  // For incoming transactions
  sender?: string;
  username?: string;
  // For outgoing transactions
  recipient?: string;
  timestamp: number;
  // For swap transactions
  swapFromMint?: string;
  swapToMint?: string;
  swapFromSymbol?: string;
  swapToSymbol?: string;
  swapToAmount?: number;
  swapToAmountUsd?: number;
  // For secure/unshield transactions
  secureTokenSymbol?: string;
  secureTokenIcon?: string;
  secureAmount?: number;
  secureAmountUsd?: number;
};

// Legacy type for internal use - will be removed
export type IncomingTransaction = {
  id: string;
  amountLamports: number;
  sender: string;
  username: string;
};

export type TransactionDetailsData = {
  id: string;
  type: "incoming" | "outgoing";
  amountLamports: number;
  transferType?: WalletTransfer["type"];
  // Optional SPL token transfer fields
  tokenMint?: string;
  tokenAmount?: string;
  tokenDecimals?: number;
  // For outgoing transactions
  recipient?: string;
  recipientUsername?: string;
  recipientAvatar?: string;
  // For incoming transactions
  sender?: string;
  senderUsername?: string;
  senderAvatar?: string;
  // Metadata
  status: TransactionStatus;
  timestamp: number;
  networkFeeLamports?: number;
  comment?: string;
  signature?: string; // Transaction signature for explorer link
  // For swap transactions
  swapFromMint?: string;
  swapToMint?: string;
  swapFromSymbol?: string;
  swapToSymbol?: string;
  swapToAmount?: number;
  swapToAmountUsd?: number;
  // For secure/unshield transactions
  secureTokenSymbol?: string;
  secureTokenIcon?: string;
  secureAmount?: number;
  secureAmountUsd?: number;
};
