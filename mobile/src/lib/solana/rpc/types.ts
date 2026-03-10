export type SolanaEnv = "mainnet" | "testnet" | "devnet" | "localnet";

export type WalletTransfer = {
  signature: string;
  slot: number;
  timestamp: number | null;
  direction: "in" | "out";
  type:
    | "transfer"
    // telegram-verification
    | "verify_telegram_init_data"
    | "store"
    // telegram-private-transfer
    | "initialize_deposit"
    | "initialize_username_deposit"
    | "modify_balance"
    | "claim_username_deposit_to_deposit"
    | "transfer_deposit"
    | "transfer_to_username_deposit"
    | "create_permission"
    | "create_username_permission"
    | "delegate"
    | "delegate_username_deposit"
    | "undelegate"
    | "undelegate_username_deposit"
    // rest
    | "swap"
    | "secure"
    | "unshield";
  amountLamports: number;
  netChangeLamports: number;
  feeLamports: number;
  status: "success" | "failed";
  counterparty?: string;
  // Optional SPL token transfer fields (used when type === "transfer" and tx is a pure token transfer)
  tokenMint?: string;
  tokenAmount?: string; // human-readable (decimal-adjusted, truncated for display)
  tokenDecimals?: number;
  // Optional swap fields (used when type === "swap")
  swapFromMint?: string;
  swapFromAmount?: string; // human-readable
  swapFromDecimals?: number;
  swapToMint?: string;
  swapToAmount?: string; // human-readable
  swapToDecimals?: number;
};

export type GetAccountTransactionHistoryOptions = {
  limit?: number;
  before?: string;
  onlySystemTransfers?: boolean;
};
