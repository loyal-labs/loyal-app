export type PrivateTransferAnalyticsFlow = "shield" | "unshield";
export type GaslessClaimSolanaEnv = "mainnet" | "devnet";
export type GaslessClaimTransactionType =
  | "store"
  | "verify_telegram_init_data"
  | "top_up_to_0_01_sol";

export type PrivateTransferModifyBalanceEventInput = {
  amountRaw: string;
  flow: PrivateTransferAnalyticsFlow;
  instructionIndex: number;
  occurredAt: Date;
  signature: string;
  slot: bigint;
  tokenMint: string;
  userAddress: string;
  vaultAddress: string;
};

export type PrivateTransferModifyBalanceEventRecord =
  PrivateTransferModifyBalanceEventInput;

export type PrivateTransferVaultHoldingRow = {
  amountRaw: string;
  snapshotAt: Date;
  tokenAccountAddress: string;
  tokenMint: string;
  vaultAddress: string;
};

export type PrivateTransferTokenCatalogUpsert = {
  decimals: number;
  name: string;
  priceUsd: string | null;
  symbol: string;
  tokenMint: string;
};

export type GaslessClaimTransactionInput = {
  occurredAt: Date;
  payerAddress: string;
  recipientAddress: string | null;
  signature: string;
  slot: bigint;
  solanaEnv: GaslessClaimSolanaEnv;
  spentLamports: string;
  transactionType: GaslessClaimTransactionType;
};

export type GaslessClaimHistorySyncStats = {
  backfillCompleted: boolean;
  backfillPagesProcessed: number;
  headPagesProcessed: number;
  latestSeenSignature: string | null;
  recordsSkippedExcludedBpfLoader: number;
  recordsSkippedMissingBlockTime: number;
  recordsSkippedUnclassified: number;
  recordsUpserted: number;
  signaturesFetched: number;
};

export type PrivateTransferHistorySyncStats = {
  backfillCompleted: boolean;
  backfillPagesProcessed: number;
  eventsInserted: number;
  eventsSkippedMissingBlockTime: number;
  headPagesProcessed: number;
  latestSeenSignature: string | null;
  signaturesFetched: number;
};

export type PrivateTransferVaultSnapshotStats = {
  holdingsUpserted: number;
  tokenCatalogUpdated: number;
  vaultsDiscovered: number;
};

export type PrivateTransferAnalyticsCronStats = {
  gaslessClaims: GaslessClaimHistorySyncStats;
  history: PrivateTransferHistorySyncStats;
  vaults: PrivateTransferVaultSnapshotStats;
};
