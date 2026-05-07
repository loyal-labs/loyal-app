import type { SolanaEnv } from "@loyal-labs/solana-rpc";
import type { Commitment, Connection, PublicKey } from "@solana/web3.js";

export type AddressInput = string | PublicKey;

export type WalletDataLogger = {
  log?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

export type AssetDescriptor = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  imageUrl: string | null;
  isNative: boolean;
};

export type AssetBalance = {
  asset: AssetDescriptor;
  balance: number;
  priceUsd: number | null;
  valueUsd: number | null;
};

export type AssetSnapshot = {
  owner: string;
  nativeBalanceLamports: number;
  assets: AssetBalance[];
  fetchedAt: number;
};

export type SecureBalanceMap = ReadonlyMap<string, bigint>;

export type SecureBalanceProviderArgs = {
  owner: PublicKey;
  env: SolanaEnv;
  tokenMints: PublicKey[];
  assetBalances: AssetBalance[];
};

export type SecureBalanceProvider = (
  args: SecureBalanceProviderArgs
) => Promise<SecureBalanceMap>;

export type AssetProviderSubscribeOptions = {
  commitment?: "processed" | "confirmed" | "finalized";
  debounceMs?: number;
  includeNative?: boolean;
};

export type AssetProvider = {
  getBalance: (owner: PublicKey) => Promise<number>;
  getAssetSnapshot: (owner: PublicKey) => Promise<AssetSnapshot>;
  /**
   * Resolve descriptors for arbitrary mints (typically those returned by a
   * `secureBalanceProvider` that the public asset snapshot doesn't cover —
   * e.g. a fully-shielded SPL mint with a closed/empty ATA).
   *
   * Implementations should return one descriptor per mint they could resolve;
   * mints they could not resolve may simply be omitted (the SDK falls back to
   * a placeholder so the row still renders).
   */
  resolveAssets?: (mints: string[]) => Promise<AssetDescriptor[]>;
  subscribeAssetChanges: (
    owner: PublicKey,
    onChange: () => void,
    options?: AssetProviderSubscribeOptions
  ) => Promise<() => Promise<void>>;
};

export type ProgramActionType =
  | "store"
  | "verify_telegram_init_data"
  | "initialize_deposit"
  | "initialize_username_deposit"
  | "claim_username_deposit_to_deposit"
  | "transfer_deposit"
  | "transfer_to_username_deposit"
  | "create_permission"
  | "create_username_permission"
  | "delegate"
  | "delegate_username_deposit"
  | "undelegate"
  | "undelegate_username_deposit";

export type WalletActivityStatus = "success" | "failed";

export type WalletTokenAmount = {
  mint: string;
  amount: string;
  decimals: number;
};

type WalletActivityBase = {
  signature: string;
  slot: number;
  timestamp: number | null;
  feeLamports: number;
  status: WalletActivityStatus;
};

export type WalletSolTransferActivity = WalletActivityBase & {
  type: "sol_transfer";
  direction: "in" | "out";
  amountLamports: number;
  netChangeLamports: number;
  counterparty?: string;
};

export type WalletTokenTransferActivity = WalletActivityBase & {
  type: "token_transfer";
  direction: "in" | "out";
  token: WalletTokenAmount;
  counterparty?: string;
};

export type WalletSwapActivity = WalletActivityBase & {
  type: "swap";
  direction: "out";
  fromToken: WalletTokenAmount;
  toToken: WalletTokenAmount;
  amountLamports: number;
  counterparty?: string;
};

export type WalletSecureActivity = WalletActivityBase & {
  type: "secure" | "unshield";
  direction: "in" | "out";
  token: WalletTokenAmount;
  counterparty?: string;
};

export type WalletProgramActionActivity = WalletActivityBase & {
  type: "program_action";
  action: ProgramActionType;
  direction: "in" | "out";
  amountLamports: number;
  netChangeLamports: number;
  counterparty?: string;
  token?: WalletTokenAmount;
};

export type WalletActivity =
  | WalletSolTransferActivity
  | WalletTokenTransferActivity
  | WalletSwapActivity
  | WalletSecureActivity
  | WalletProgramActionActivity;

export type GetActivityOptions = {
  limit?: number;
  before?: string;
  onlySystemTransfers?: boolean;
};

export type SubscribeActivityOptions = {
  onlySystemTransfers?: boolean;
  emitInitial?: boolean;
  fallbackRefreshMs?: number;
  historyLimit?: number;
  onError?: (error: unknown) => void;
};

export type ActivityPage = {
  activities: WalletActivity[];
  nextCursor?: string;
};

export type ActivityProvider = {
  getActivity: (
    owner: PublicKey,
    options?: GetActivityOptions
  ) => Promise<ActivityPage>;
  subscribeActivity: (
    owner: PublicKey,
    onActivity: (activity: WalletActivity) => void,
    options?: SubscribeActivityOptions
  ) => Promise<() => Promise<void>>;
};

export type PortfolioPosition = {
  asset: AssetDescriptor;
  publicBalance: number;
  securedBalance: number;
  totalBalance: number;
  priceUsd: number | null;
  publicValueUsd: number | null;
  securedValueUsd: number | null;
  totalValueUsd: number | null;
};

export type PortfolioHolding = {
  mint: string;
  symbol: string;
  name: string;
  balance: number;
  decimals: number;
  priceUsd: number | null;
  valueUsd: number | null;
  imageUrl: string | null;
  isNative: boolean;
  kind: "public" | "secured" | "total";
  isSecured?: boolean;
};

export type PortfolioTotals = {
  totalUsd: number;
  totalSol: number | null;
  pricedCount: number;
  unpricedCount: number;
  effectiveSolPriceUsd: number | null;
};

export type PortfolioSnapshot = {
  owner: string;
  nativeBalanceLamports: number;
  positions: PortfolioPosition[];
  totals: PortfolioTotals;
  fetchedAt: number;
};

export type GetPortfolioOptions = {
  forceRefresh?: boolean;
  fallbackSolPriceUsd?: number | null;
};

export type SubscribePortfolioOptions = {
  commitment?: "processed" | "confirmed" | "finalized";
  debounceMs?: number;
  emitInitial?: boolean;
  fallbackRefreshMs?: number;
  fallbackSolPriceUsd?: number | null;
  onError?: (error: unknown) => void;
};

export type CreateSolanaWalletDataClientConfig = {
  env: SolanaEnv;
  rpcEndpoint?: string;
  websocketEndpoint?: string;
  commitment?: Commitment;
  fetch?: typeof fetch;
  logger?: WalletDataLogger;
  assetProvider?: AssetProvider;
  activityProvider?: ActivityProvider;
  secureBalanceProvider?: SecureBalanceProvider;
  createRpcConnection?: (
    rpcEndpoint: string,
    commitment: Commitment
  ) => Connection;
  createWebsocketConnection?: (
    rpcEndpoint: string,
    websocketEndpoint: string,
    commitment: Commitment
  ) => Connection;
};

export type SolanaWalletDataClient = {
  env: SolanaEnv;
  rpcEndpoint: string;
  websocketEndpoint: string;
  getBalance: (publicKey: AddressInput) => Promise<number>;
  getPortfolio: (
    publicKey: AddressInput,
    options?: GetPortfolioOptions
  ) => Promise<PortfolioSnapshot>;
  subscribePortfolio: (
    publicKey: AddressInput,
    onPortfolio: (snapshot: PortfolioSnapshot) => void,
    options?: SubscribePortfolioOptions
  ) => Promise<() => Promise<void>>;
  getActivity: (
    publicKey: AddressInput,
    options?: GetActivityOptions
  ) => Promise<ActivityPage>;
  subscribeActivity: (
    publicKey: AddressInput,
    onActivity: (activity: WalletActivity) => void,
    options?: SubscribeActivityOptions
  ) => Promise<() => Promise<void>>;
};
