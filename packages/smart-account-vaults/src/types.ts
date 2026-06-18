import type { PreparedLoyalSmartAccountsOperation } from "@loyal-labs/loyal-smart-accounts";
import type { LoyalCluster } from "@loyal-labs/actions";
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
  statusTimestamp: number | null;
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
  lamports: number | null;
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
  accountIndex: number | null;
  mint: string | null;
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

export type SmartAccountVaultBaseSnapshot = Pick<
  SmartAccountVaultSnapshot,
  "accountIndex" | "address"
>;

export type SmartAccountOverviewBase = Omit<
  SmartAccountOverview,
  "policies" | "spendingLimits" | "vaults" | "proposals"
> & {
  accountUtilization: number;
  vaults: SmartAccountVaultBaseSnapshot[];
};

export type SmartAccountPolicyOverview = {
  signers: SmartAccountSignerSnapshot[];
  policies: SmartAccountPolicySnapshot[];
  spendingLimits: SmartAccountSpendingLimitSnapshot[];
};

export type SmartAccountOverview = {
  programId: string;
  settingsPda: string;
  threshold: number;
  timeLock: number;
  transactionIndex: string;
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
  /**
   * Permissions to grant the new policy signer. Defaults to
   * `["initiate"]` (the legacy behavior). Pass a richer set to add a
   * signer that can also vote or execute within the spending-limit
   * policy.
   */
  permissions?: SmartAccountSignerPermission[];
};

export type SmartAccountRemoveSignerProposalInput = {
  settingsPda: PublicKey;
  creator: PublicKey;
  feePayer: PublicKey;
  signer: PublicKey;
  policyPda?: PublicKey | null;
  accountIndex?: number;
  memo?: string;
};

export type SmartAccountUpdateSignerPermissionsInput = {
  settingsPda: PublicKey;
  creator: PublicKey;
  feePayer: PublicKey;
  signer: PublicKey;
  /**
   * Final permission set for the signer. Must be non-empty. The helper
   * emits a single settings change combining `RemoveSigner` + `AddSigner`
   * with the new permissions.
   */
  permissions: SmartAccountSignerPermission[];
  memo?: string;
};

export type SmartAccountRootSignerChangeInput = {
  settingsPda: PublicKey;
  creator: PublicKey;
  feePayer: PublicKey;
  signer: PublicKey;
  memo?: string;
};

export type SmartAccountAddRootSignerInput =
  SmartAccountRootSignerChangeInput & {
    /**
     * Root Settings permissions to grant. Defaults to all current Settings
     * permissions so the added wallet can initiate, vote, and execute.
     */
    permissions?: SmartAccountSignerPermission[];
  };

export type SmartAccountRemoveRootSignerInput =
  SmartAccountRootSignerChangeInput;

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

export type SmartAccountClosePoliciesProposalInput = {
  settingsPda: PublicKey;
  creator: PublicKey;
  feePayer: PublicKey;
  policies: PublicKey[];
  memo?: string;
};

export type SmartAccountClosePolicyProposalInput = Omit<
  SmartAccountClosePoliciesProposalInput,
  "policies"
> & {
  policy: PublicKey;
};

export type SmartAccountClosePoliciesSyncInput = Omit<
  SmartAccountClosePoliciesProposalInput,
  "creator"
> & {
  signers: PublicKey[];
};

export type SmartAccountClosePolicySyncInput = Omit<
  SmartAccountClosePoliciesSyncInput,
  "policies"
> & {
  policy: PublicKey;
};

export type SmartAccountCloseYieldRoutingPoliciesProposalInput =
  SmartAccountClosePoliciesProposalInput;

export type SmartAccountCloseYieldRoutingPolicyProposalInput =
  SmartAccountClosePolicyProposalInput;

export type SmartAccountCloseYieldRoutingPoliciesSyncInput =
  SmartAccountClosePoliciesSyncInput;

export type SmartAccountCloseYieldRoutingPolicySyncInput =
  SmartAccountClosePolicySyncInput;

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

export type SmartAccountEarnUsdcReserveTargetInput = {
  reserve: PublicKey;
  market: PublicKey;
  liquidityMint: PublicKey;
  supplyApyBps?: bigint | null;
  reserveCollateralMint?: PublicKey;
  reserveLiquiditySupply?: PublicKey;
};

export type SmartAccountEarnUsdcDepositInput = {
  settingsPda: PublicKey;
  walletAddress: PublicKey;
  policySigner: PublicKey;
  feePayer: PublicKey;
  amountRaw: bigint;
  cluster?: LoyalCluster;
  target?: SmartAccountEarnUsdcReserveTargetInput;
  initializeYieldRoutingPolicy?: boolean;
  yieldRoutingPolicy?: {
    account: PublicKey;
    seed: bigint;
    prepareSetupPolicy?: boolean;
    setupPolicy?: {
      account: PublicKey;
      seed: bigint;
    } | null;
  };
  memo?: string;
};

export type SmartAccountEarnUsdcYieldRoutingPolicyInput = {
  settingsPda: PublicKey;
  walletAddress: PublicKey;
  signer: PublicKey;
  feePayer: PublicKey;
  cluster?: LoyalCluster;
  target?: SmartAccountEarnUsdcReserveTargetInput;
  memo?: string;
};

export type SmartAccountEarnUsdcYieldRoutingPolicyMetadata = {
  cluster: LoyalCluster;
  walletAddress: string;
  delegatedSigner: string;
  settings: string;
  vaultIndex: 1;
  vaultPubkey: string;
  policyId: string;
  policyAccount: string;
  policySeed: string;
  setupPolicyId: string;
  setupPolicyAccount: string;
  setupPolicySeed: string;
  targetReserve: string;
  market: string;
  liquidityMint: string;
  riskProfile: string;
  routeModes: string[];
  stableMints: string[];
  kaminoMarkets: string[];
  kaminoLiquidityMints: string[];
  universePreset: string;
};

export type SmartAccountPreparedEarnUsdcYieldRoutingPolicy = {
  finalizePrepared?: PreparedLoyalSmartAccountsOperation<string>;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  policy: {
    account: PublicKey;
    id: bigint;
    seed: bigint;
  };
  setupPolicy: {
    account: PublicKey;
    id: bigint;
    seed: bigint;
    initObligationInstructionConstraintIndex: 0;
  };
  vault: {
    accountIndex: 1;
    pubkey: PublicKey;
  };
  targetReserve: {
    reserve: PublicKey;
    market: PublicKey;
    liquidityMint: PublicKey;
    obligation: PublicKey;
  };
  persistence: SmartAccountEarnUsdcYieldRoutingPolicyMetadata;
};

export type SmartAccountEarnUsdcDepositMetadata = {
  cluster: LoyalCluster;
  walletAddress: string;
  delegatedSigner: string;
  settings: string;
  vaultIndex: 1;
  vaultPubkey: string;
  policyId: string;
  policyAccount: string;
  policySeed: string;
  setupPolicyId?: string;
  setupPolicyAccount?: string;
  setupPolicySeed?: string;
  targetReserve: string;
  market: string;
  liquidityMint: string;
  depositMint: string;
  principalAmountRaw: string;
  policyInitialization: "create" | "reuse";
  targetSupplyApyBps: string | null;
  riskProfile: string;
  routeModes: string[];
  stableMints: string[];
  kaminoMarkets: string[];
  kaminoLiquidityMints: string[];
  universePreset: string;
};

export type SmartAccountPreparedEarnUsdcDeposit = {
  kaminoSetupAccountCount: number;
  kaminoSetupRentLamports: string;
  kaminoSetupRequired: boolean;
  policyFinalizePrepared?: PreparedLoyalSmartAccountsOperation<string> | null;
  policySetupPrepared?: PreparedLoyalSmartAccountsOperation<string> | null;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  policy: {
    account: PublicKey;
    id: bigint;
    seed: bigint;
    sameMintInstructionConstraintIndexes: readonly [number, number];
  };
  setupPolicy?: {
    account: PublicKey;
    id: bigint;
    seed: bigint;
    initObligationInstructionConstraintIndex: 0;
  };
  vault: {
    accountIndex: 1;
    collateralAta: PublicKey | null;
    pubkey: PublicKey;
    usdcAta: PublicKey;
  };
  targetReserve: {
    reserve: PublicKey;
    market: PublicKey;
    liquidityMint: PublicKey;
    obligation: PublicKey;
    supplyApyBps: bigint | null;
  };
  persistence: SmartAccountEarnUsdcDepositMetadata;
};

type SmartAccountEarnUsdcWithdrawBaseInput = {
  settingsPda: PublicKey;
  walletAddress: PublicKey;
  policySigner: PublicKey;
  feePayer: PublicKey;
  amountRaw: bigint;
  cluster?: LoyalCluster;
  closePoliciesOnFullWithdrawal?: boolean;
  source?:
    | {
        type: "reserve";
        id: string;
        amountRaw: bigint;
        liquidityMint: PublicKey;
        market: PublicKey;
        reserve: PublicKey;
      }
    | {
        type: "idle";
        id: string;
        amountRaw: bigint;
        mint: PublicKey;
        tokenAccount: PublicKey;
      };
  target?: SmartAccountEarnUsdcReserveTargetInput;
  fullWithdrawalTargets?: Array<
    SmartAccountEarnUsdcReserveTargetInput & {
      amountRaw?: bigint;
      vaultCollateralAta?: PublicKey;
    }
  >;
  yieldRoutingPolicy?: {
    account: PublicKey;
    seed: bigint;
    setupPolicy?: {
      account: PublicKey;
      seed: bigint;
    } | null;
  };
  memo?: string;
};

export type SmartAccountEarnUsdcWithdrawAutodepositCloseInput = {
  policy: PublicKey;
  recurringDelegation: PublicKey;
};

export type SmartAccountEarnUsdcWithdrawInput =
  | (SmartAccountEarnUsdcWithdrawBaseInput & {
      mode: "partial";
      autodepositClose?: never;
    })
  | (SmartAccountEarnUsdcWithdrawBaseInput & {
      mode: "full";
      autodepositClose?: SmartAccountEarnUsdcWithdrawAutodepositCloseInput;
    });

export type SmartAccountEarnUsdcWithdrawMetadata = {
  cluster: LoyalCluster;
  walletAddress: string;
  delegatedSigner: string;
  settings: string;
  vaultIndex: 1;
  vaultPubkey: string;
  policyId: string;
  policyAccount: string;
  policySeed: string;
  setupPolicyId?: string;
  setupPolicyAccount?: string;
  setupPolicySeed?: string;
  targetReserve: string;
  market: string;
  liquidityMint: string;
  withdrawnAmountRaw: string;
  mode: "partial" | "full";
  sourceType?: "reserve" | "idle";
  sourceId?: string;
  sourceAmountRaw?: string;
  sourceTokenAccount?: string;
  sourceMint?: string;
  sourceMetadata?: Record<string, unknown>;
  kaminoWithdrawAmountRaw?: string;
  vaultCollateralCleanupIncluded?: boolean;
  vaultUsdcRemainderRaw?: string;
  walletTransferAmountRaw?: string;
  autodepositClose?: SmartAccountEarnUsdcAutodepositCloseMetadata | null;
  accountingReserve?: string;
  executionReserve?: string;
  reserveWithdrawals?: SmartAccountEarnUsdcReserveWithdrawalMetadata[];
  stepIndex?: number;
  stepCount?: number;
  isFinalStep?: boolean;
};

export type SmartAccountEarnUsdcReserveWithdrawalMetadata = {
  accountingReserve: string;
  collateralAta: string;
  executionMarket: string;
  executionReserve: string;
  kaminoWithdrawAmountRaw: string;
  liquidityMint: string;
  market: string | null;
  reserve: string;
  withdrawnAmountRaw: string;
};

export type SmartAccountPreparedEarnUsdcWithdrawStep = {
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  stepIndex: number;
  stepCount: number;
  amountRaw: bigint;
  mode: "partial" | "full";
  collateralAta: PublicKey;
  accountingReserve: {
    reserve: PublicKey;
    market: PublicKey;
    liquidityMint: PublicKey;
    obligation: PublicKey;
  };
  executionReserve: {
    reserve: PublicKey;
    market: PublicKey;
    liquidityMint: PublicKey;
  };
  reserveWithdrawals: SmartAccountEarnUsdcReserveWithdrawalMetadata[];
  persistence: SmartAccountEarnUsdcWithdrawMetadata;
};

export type SmartAccountPreparedEarnUsdcWithdraw = {
  autodepositClosePrepared?: SmartAccountPreparedEarnUsdcAutodepositClose | null;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  withdrawSteps: SmartAccountPreparedEarnUsdcWithdrawStep[];
  mode: "partial" | "full";
  amountRaw: bigint;
  policy: {
    account: PublicKey;
    id: bigint;
    seed: bigint;
    withdrawInstructionConstraintIndex: 0;
    sameMintInstructionConstraintIndexes: readonly [number, number];
  };
  setupPolicy?: {
    account: PublicKey;
    id: bigint;
    seed: bigint;
  };
  vault: {
    accountIndex: 1;
    pubkey: PublicKey;
    usdcAta: PublicKey;
    collateralAta: PublicKey;
  };
  targetReserve: {
    reserve: PublicKey;
    market: PublicKey;
    liquidityMint: PublicKey;
    obligation: PublicKey;
  };
  persistence: SmartAccountEarnUsdcWithdrawMetadata;
};

export type SmartAccountEarnUsdcAutodepositSetupInput = {
  settingsPda: PublicKey;
  walletAddress: PublicKey;
  feePayer: PublicKey;
  signer: PublicKey;
  policySigner: PublicKey;
  amountRaw: bigint;
  minimumDelegatorBalanceRaw?: bigint;
  cluster?: LoyalCluster;
  nonce?: bigint;
  policySeed?: bigint;
  periodLengthSeconds?: bigint;
  startTimestamp?: bigint;
  expiryTimestamp?: bigint;
  memo?: string;
};

export type SmartAccountEarnUsdcAutodepositSetupMetadata = {
  cluster: LoyalCluster;
  walletAddress: string;
  delegatedSigner: string;
  settings: string;
  vaultIndex: 1;
  vaultPubkey: string;
  policyId: string | null;
  policyAccount: string | null;
  policySeed: string | null;
  subscriptionDelegatee: string;
  amountPerPeriodRaw: string;
  minimumDelegatorBalanceRaw: string | null;
  periodLengthSeconds: string;
  nonce: string;
  startTimestamp: string;
  expiryTimestamp: string;
  liquidityMint: string;
  subscriptionAuthority: string;
  recurringDelegation: string;
  walletUsdcAta: string;
  vaultUsdcAta: string;
  subscriptionAuthorityInitialization: "required" | "exists";
};

export type SmartAccountPreparedEarnUsdcAutodepositSetup = {
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  stage:
    | "initialize_subscription_authority"
    | "create_policy"
    | "create_recurring_delegation";
  authorityInitializationRequired: boolean;
  policy: {
    account: PublicKey | null;
    id: bigint | null;
    seed: bigint | null;
  };
  vault: {
    accountIndex: 1;
    pubkey: PublicKey;
    usdcAta: PublicKey;
  };
  subscription: {
    authority: PublicKey;
    recurringDelegation: PublicKey;
    amountPerPeriodRaw: bigint;
    periodLengthSeconds: bigint;
    nonce: bigint;
    startTimestamp: bigint;
    expiryTimestamp: bigint;
  };
  persistence: SmartAccountEarnUsdcAutodepositSetupMetadata;
};

export type SmartAccountEarnUsdcAutodepositCloseInput = {
  settingsPda: PublicKey;
  walletAddress: PublicKey;
  feePayer: PublicKey;
  signer: PublicKey;
  policySigner: PublicKey;
  policy: PublicKey;
  recurringDelegation: PublicKey;
  cluster?: LoyalCluster;
  memo?: string;
};

export type SmartAccountEarnUsdcAutodepositCloseMetadata = {
  cluster: LoyalCluster;
  walletAddress: string;
  delegatedSigner: string;
  settings: string;
  vaultIndex: 1;
  vaultPubkey: string;
  policyAccount: string;
  recurringDelegation: string;
};

export type SmartAccountPreparedEarnUsdcAutodepositClose = {
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  policy: {
    account: PublicKey;
  };
  vault: {
    accountIndex: 1;
    pubkey: PublicKey;
  };
  subscription: {
    recurringDelegation: PublicKey;
  };
  persistence: SmartAccountEarnUsdcAutodepositCloseMetadata;
};

export type SmartAccountEarnUsdcAutodepositPullInput = {
  policy: PublicKey;
  walletAddress: PublicKey;
  feePayer: PublicKey;
  policySigner: PublicKey;
  recurringDelegation: PublicKey;
  amountRaw: bigint;
  cluster?: LoyalCluster;
  memo?: string;
};

export type SmartAccountEarnUsdcAutodepositPullMetadata = {
  cluster: LoyalCluster;
  walletAddress: string;
  delegatedSigner: string;
  vaultIndex: 1;
  vaultPubkey: string;
  policyAccount: string;
  recurringDelegation: string;
  amountRaw: string;
  liquidityMint: string;
  subscriptionAuthority: string;
  walletUsdcAta: string;
  vaultUsdcAta: string;
};

export type SmartAccountPreparedEarnUsdcAutodepositPull = {
  prepared: PreparedLoyalSmartAccountsOperation<string>;
  policy: {
    account: PublicKey;
  };
  vault: {
    accountIndex: 1;
    pubkey: PublicKey;
    usdcAta: PublicKey;
  };
  subscription: {
    authority: PublicKey;
    recurringDelegation: PublicKey;
  };
  persistence: SmartAccountEarnUsdcAutodepositPullMetadata;
};

export type SmartAccountPreparedSettingsChange = {
  transactionIndex: bigint;
  prepared: PreparedLoyalSmartAccountsOperation<string>;
};
