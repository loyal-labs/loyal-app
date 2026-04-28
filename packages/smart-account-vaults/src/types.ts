import type { PreparedLoyalSmartAccountsOperation } from "@loyal-labs/loyal-smart-accounts";
import type { DecodedSolanaInstruction } from "@loyal-labs/solana-instruction-decoder";
import type {
  ActivityPage,
  PortfolioSnapshot,
  SolanaWalletDataClient,
} from "@loyal-labs/solana-wallet";
import type {
  Connection,
  PublicKey,
  SendOptions,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import type { SmartAccountSpendingLimitPeriod } from "./spending-limits";

export type SmartAccountProposalStatus =
  | "draft"
  | "active"
  | "approved"
  | "rejected"
  | "executing"
  | "executed"
  | "cancelled";

export type SmartAccountProposalSummaryKind =
  | "sol_transfer"
  | "spl_transfer"
  | "settings_change"
  | "unknown";

export type SmartAccountProposalSummary = {
  kind: SmartAccountProposalSummaryKind;
  title: string;
  subtitle: string;
  symbol: string | null;
  amountUi: string | null;
  amountRaw: string | null;
  mint: string | null;
  decimals: number | null;
  destination: string | null;
  programId: string | null;
  instructionCount: number;
};

export type SmartAccountProposalPayloadType =
  | "transaction"
  | "settings_transaction"
  | "policy_transaction"
  | "unknown";

export type SmartAccountProposalSnapshot = {
  proposalAddress: string;
  transactionAddress: string | null;
  consensusAddress: string;
  transactionIndex: string;
  payloadType: SmartAccountProposalPayloadType;
  status: SmartAccountProposalStatus;
  approvals: string[];
  rejections: string[];
  cancellations: string[];
  creator: string | null;
  accountIndex: number | null;
  summary: SmartAccountProposalSummary;
  decodedInstructions: DecodedSolanaInstruction[];
};

export type SmartAccountSignerPermission = "initiate" | "vote" | "execute";

export type SmartAccountSignerScope = "settings" | "policy";

export type SmartAccountSignerSnapshot = {
  address: string;
  scope: SmartAccountSignerScope;
  consensusAddress: string;
  permissions: SmartAccountSignerPermission[];
  permissionMask: number;
  canInitiate: boolean;
  canVote: boolean;
  canExecute: boolean;
  threshold: number;
  timeLock: number;
  policyAddress: string | null;
  policySeed: string | null;
};

export type SmartAccountPolicySnapshot = {
  address: string;
  settingsPda: string;
  seed: string;
  threshold: number;
  timeLock: number;
  transactionIndex: string;
  staleTransactionIndex: string;
  state: string;
  signers: SmartAccountSignerSnapshot[];
};

export type SmartAccountSpendingLimitSnapshot = {
  address: string;
  settingsPda: string;
  seed: string;
  accountIndex: number;
  mint: string;
  symbol: string;
  decimals: number;
  amountRaw: string;
  remainingAmountRaw: string;
  effectiveRemainingAmountRaw: string;
  maxPerUseRaw: string;
  amountUi: string;
  remainingAmountUi: string;
  amountUsd: number | null;
  remainingAmountUsd: number | null;
  period: SmartAccountSpendingLimitPeriod;
  periodSeconds: number | null;
  periodLabel: string;
  accumulateUnused: boolean;
  lastReset: number;
  nextReset: number | null;
  expiration: number | null;
  isExpired: boolean;
  signers: string[];
  destinations: string[];
};

export type SmartAccountVaultSnapshot = {
  accountIndex: number;
  address: string;
  lamports: number;
  portfolio: PortfolioSnapshot;
  activity: ActivityPage;
  signers: SmartAccountSignerSnapshot[];
  spendingLimits: SmartAccountSpendingLimitSnapshot[];
};

export type SmartAccountOverview = {
  programId: string;
  settingsPda: string;
  threshold: number;
  timeLock: number;
  staleTransactionIndex: string;
  canonicalVaultAddress: string;
  signers: SmartAccountSignerSnapshot[];
  policies: SmartAccountPolicySnapshot[];
  spendingLimits: SmartAccountSpendingLimitSnapshot[];
  vaults: SmartAccountVaultSnapshot[];
  proposals: SmartAccountProposalSnapshot[];
  fetchedAt: number;
};

export type SmartAccountVaultsClientConfig = {
  connection: Connection;
  programId?: PublicKey;
  walletDataClient?: SolanaWalletDataClient;
};

export type WalletAdapterLike = {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T
  ): Promise<T>;
  sendTransaction?(
    transaction: Transaction | VersionedTransaction,
    connection: Connection,
    options?: SendOptions
  ): Promise<string>;
};

export type SendPreparedWithWalletArgs = {
  connection: Connection;
  wallet: WalletAdapterLike;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  confirm?: boolean | "if-required";
  sendOptions?: SendOptions;
};

export type SmartAccountTransferProposalInput = {
  settingsPda: PublicKey;
  creator: PublicKey;
  feePayer: PublicKey;
  destination: PublicKey;
  amountLamports: bigint;
  accountIndex?: number;
  memo?: string;
};

export type SmartAccountTokenTransferProposalInput = {
  settingsPda: PublicKey;
  creator: PublicKey;
  feePayer: PublicKey;
  mint: PublicKey;
  destinationOwner: PublicKey;
  amount: bigint;
  decimals: number;
  accountIndex?: number;
  destinationTokenAccount?: PublicKey;
  memo?: string;
  tokenProgramId?: PublicKey;
  createDestinationAta?: boolean;
};

export type SmartAccountCustomInstructionProposalInput = {
  settingsPda: PublicKey;
  creator: PublicKey;
  feePayer: PublicKey;
  instructions: TransactionInstruction[];
  accountIndex?: number;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  memo?: string;
};

export type SmartAccountAddSignerProposalInput = {
  settingsPda: PublicKey;
  creator: PublicKey;
  feePayer: PublicKey;
  signer: PublicKey;
  policyPda?: PublicKey | null;
  accountIndex?: number;
  memo?: string;
};

export type SmartAccountPolicyCustomInstructionProposalInput = {
  policyPda: PublicKey;
  creator: PublicKey;
  feePayer: PublicKey;
  instructions: TransactionInstruction[];
  accountIndex?: number;
  addressLookupTableAccounts?: AddressLookupTableAccount[];
  instructionConstraintIndices?: Uint8Array;
  memo?: string;
};

export type SmartAccountSetSpendingLimitProposalInput = {
  settingsPda: PublicKey;
  creator: PublicKey;
  feePayer: PublicKey;
  signer: PublicKey;
  amount: bigint;
  accountIndex?: number;
  mint?: PublicKey;
  period?: SmartAccountSpendingLimitPeriod;
  destinations?: PublicKey[];
  expiration?: number | null;
  existingSpendingLimitPolicy?: PublicKey | null;
  memo?: string;
};

export type SmartAccountRemoveSpendingLimitProposalInput = {
  settingsPda: PublicKey;
  creator: PublicKey;
  feePayer: PublicKey;
  spendingLimitPolicy: PublicKey;
  memo?: string;
};

export type SmartAccountUseSpendingLimitInput = {
  settingsPda: PublicKey;
  feePayer: PublicKey;
  signer: PublicKey;
  spendingLimitPolicy: PublicKey;
  destination: PublicKey;
  amountLamports: bigint;
  accountIndex?: number;
  memo?: string;
};

export type SmartAccountPreparedSettingsChange = {
  transactionIndex: bigint;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
};
