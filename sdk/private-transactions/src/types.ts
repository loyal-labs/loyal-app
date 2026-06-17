import type {
  PublicKey,
  Transaction,
  VersionedTransaction,
  Keypair,
  Commitment,
  TransactionInstruction,
} from "@solana/web3.js";
import type { AnchorProvider } from "@coral-xyz/anchor";

/**
 * Minimal wallet interface matching @solana/wallet-adapter-base
 * Compatible with browser wallet adapters (Phantom, Solflare, etc.)
 */
export interface WalletLike {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T
  ): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]>;
}

/**
 * Union type supporting multiple wallet types:
 * - WalletLike: Browser wallet adapters (Phantom, Solflare, etc.)
 * - Keypair: Server-side scripts and testing
 * - AnchorProvider: Existing Anchor projects
 */
export type WalletSigner = WalletLike | Keypair | AnchorProvider;

export type InstructionCheck = {
  address: PublicKey;
  delegated: boolean;
  passNotExist: boolean;
  label: string;
};

export type CheckedTransactionInstruction = {
  ix: TransactionInstruction;
  ensure: InstructionCheck[];
};

export type ShieldFlowKind = "shield" | "unshield";

export type FeeEstimateCluster = "base" | "ephemeral";

export interface BuildShieldFlowTransactionPlanParams {
  kind: ShieldFlowKind;
  user: PublicKey;
  tokenMint: PublicKey;
  amount: number | bigint;
  payer?: PublicKey;
  validator?: PublicKey;
  magicProgram?: PublicKey;
  magicContext?: PublicKey;
}

export type BuildShieldTokensTransactionPlanParams = Omit<
  BuildShieldFlowTransactionPlanParams,
  "kind"
>;

export type BuildUnshieldTokensTransactionPlanParams = Omit<
  BuildShieldFlowTransactionPlanParams,
  "kind"
>;

export interface EstimateShieldFlowFeeParams {
  plan: ShieldFlowPlan;
  commitment?: Commitment;
}

export interface EstimateShieldTokensFeeParams
  extends EstimateShieldFlowFeeParams {}

export interface EstimateUnshieldTokensFeeParams
  extends EstimateShieldFlowFeeParams {}

export interface ExecuteShieldFlowTransactionPlanParams {
  plan: ShieldFlowPlan;
  rpcOptions?: RpcOptions;
}

export interface ExecuteShieldTokensTransactionPlanParams
  extends ExecuteShieldFlowTransactionPlanParams {}

export interface ExecuteUnshieldTokensTransactionPlanParams
  extends ExecuteShieldFlowTransactionPlanParams {}

export interface ShieldTokensClientParams {
  user: PublicKey;
  tokenMint: PublicKey;
  amount: number | bigint;
  payer?: PublicKey;
  validator?: PublicKey;
  magicProgram?: PublicKey;
  magicContext?: PublicKey;
  rpcOptions?: RpcOptions;
}

export interface UnshieldTokensClientParams {
  user: PublicKey;
  tokenMint: PublicKey;
  amount: number | bigint;
  payer?: PublicKey;
  validator?: PublicKey;
  magicProgram?: PublicKey;
  magicContext?: PublicKey;
  rpcOptions?: RpcOptions;
}

export interface InstructionCostEstimate {
  transactionIndex: number;
  instructionIndex: number;
  label: string;
  programId: PublicKey;
  /**
   * Net rent impact for this instruction.
   * Positive values are newly locked rent; negative values are reclaimed rent.
   */
  rentLamports: number;
  /**
   * Net native-SOL value movement caused by token semantics, excluding fees and rent.
   * Positive values debit the payer/user, negative values credit them.
   */
  nativeLamports: number;
}

export interface ShieldFlowInstructionPlan {
  label: string;
  ix: TransactionInstruction;
  /**
   * Net rent impact for this instruction.
   * Positive values are newly locked rent; negative values are reclaimed rent.
   */
  rentLamports?: number;
  /**
   * Net native-SOL value movement caused by token semantics, excluding fees and rent.
   * Positive values debit the payer/user, negative values credit them.
   */
  nativeLamports?: number;
}

export interface ShieldFlowOwnerChangeWait {
  address: PublicKey;
  owner: PublicKey;
  bestEffort?: boolean;
}

export interface ShieldFlowTransactionPlan {
  label: string;
  cluster: FeeEstimateCluster;
  instructions: ShieldFlowInstructionPlan[];
  checks?: InstructionCheck[];
  postSendOwnerChange?: ShieldFlowOwnerChangeWait;
}

export interface ShieldFlowPlan {
  kind: ShieldFlowKind;
  user: PublicKey;
  payer: PublicKey;
  tokenMint: PublicKey;
  amount: bigint;
  transactions: ShieldFlowTransactionPlan[];
}

export interface ShieldFlowTransactionFeeEstimate {
  index: number;
  label: string;
  cluster: FeeEstimateCluster;
  feePayer: PublicKey;
  blockhash: string;
  lastValidBlockHeight: number;
  instructionCount: number;
  feeLamports: number;
  rentLamports: number;
  nativeLamports: number;
  totalLamports: number;
  instructions: InstructionCostEstimate[];
}

export interface ShieldFlowFeeEstimate {
  kind: ShieldFlowKind;
  user: PublicKey;
  payer: PublicKey;
  tokenMint: PublicKey;
  amount: bigint;
  totalFeeLamports: number;
  totalRentLamports: number;
  totalNativeLamports: number;
  feeAndRentLamports: number;
  totalLamports: number;
  transactions: ShieldFlowTransactionFeeEstimate[];
  instructions: InstructionCostEstimate[];
  note: string;
}

export interface ShieldFlowTransactionExecutionResult {
  index: number;
  label: string;
  cluster: FeeEstimateCluster;
  signature: string;
}

export interface ShieldFlowExecutionResult {
  kind: ShieldFlowKind;
  user: PublicKey;
  payer: PublicKey;
  tokenMint: PublicKey;
  amount: bigint;
  signatures: ShieldFlowTransactionExecutionResult[];
}

/**
 * RPC options for transactions
 */
export interface RpcOptions {
  skipPreflight?: boolean;
  preflightCommitment?: Commitment;
  maxRetries?: number;
}

/**
 * Configuration for creating an ephemeral client
 */
export interface ClientConfig {
  signer: WalletSigner;
  baseRpcEndpoint: string;
  baseWsEndpoint?: string;
  ephemeralRpcEndpoint: string;
  ephemeralWsEndpoint?: string;
  commitment?: Commitment;
  authToken?: {
    token: string;
    expiresAt: number;
  };
}

/**
 * Data structure for a user deposit account
 */
export interface DepositData {
  user: PublicKey;
  tokenMint: PublicKey;
  amount: bigint;
  address: PublicKey;
}

export interface KaminoReserveSnapshot {
  reserve: PublicKey;
  tokenMint: PublicKey;
  liquidityDecimals: number;
  collateralSupplyRaw: bigint;
  totalLiquiditySupplyScaled: bigint;
  collateralExchangeRateSf: bigint;
}

export interface KaminoTrackedBalanceCostBasis {
  trackedShareAmountRaw: bigint;
  trackedLiquidityAmountRaw: bigint;
}

export interface KaminoPositionYieldInfo {
  reserve: PublicKey;
  tokenMint: PublicKey;
  liquidityDecimals: number;
  shareAmountRaw: bigint;
  currentLiquidityAmountRaw: bigint;
  trackedShareAmountRaw: bigint | null;
  trackedLiquidityAmountRaw: bigint | null;
  currentTrackedLiquidityCostBasisRaw: bigint | null;
  earnedLiquidityAmountRaw: bigint | null;
}

/**
 * Data structure for a username-based deposit account
 */
export interface UsernameDepositData {
  usernameHash: number[];
  tokenMint: PublicKey;
  amount: bigint;
  address: PublicKey;
}

/**
 * Parameters for initializing a deposit account
 */
export interface InitializeDepositParams {
  user: PublicKey;
  tokenMint: PublicKey;
  payer: PublicKey;
  rpcOptions?: RpcOptions;
}

export interface InitializeUsernameDepositParams {
  username: string;
  tokenMint: PublicKey;
  payer: PublicKey;
  rpcOptions?: RpcOptions;
}

export interface CloseDepositParams {
  user: PublicKey;
  tokenMint: PublicKey;
  rpcOptions?: RpcOptions;
}

export interface CloseUsernameDepositParams {
  username: string;
  tokenMint: PublicKey;
  authority: PublicKey;
  session: PublicKey;
  rpcOptions?: RpcOptions;
}

export interface ClosePermissionParams {
  user: PublicKey;
  tokenMint: PublicKey;
  rpcOptions?: RpcOptions;
}

/**
 * Parameters for modifying a deposit balance
 */
export interface ModifyBalanceParams {
  user: PublicKey;
  tokenMint: PublicKey;
  amount: number | bigint;
  increase: boolean;
  payer: PublicKey;
  rpcOptions?: RpcOptions;
  passNotExist?: boolean;
}

/**
 * Result of a balance modification
 */
export interface ModifyBalanceResult {
  signature: string;
  deposit: DepositData;
}

export interface GetKaminoShieldedBalanceQuoteParams {
  tokenMint: PublicKey;
  collateralSharesAmountRaw: number | bigint;
  principalLiquidityAmountRaw?: number | bigint | null;
  shieldCollateralExchangeRateSf?: number | bigint | null;
}

export interface GetKaminoCollateralSharesForLiquidityAmountParams {
  tokenMint: PublicKey;
  liquidityAmountRaw: number | bigint;
}

export interface KaminoShieldedBalanceQuote {
  snapshot: KaminoReserveSnapshot;
  collateralSharesAmountRaw: bigint;
  redeemableLiquidityAmountRaw: bigint;
  principalLiquidityAmountRaw: bigint | null;
  earnedLiquidityAmountRaw: bigint | null;
  shieldCollateralExchangeRateSf: bigint | null;
}

export interface ClaimUsernameDepositToDepositParams {
  username: string;
  tokenMint: PublicKey;
  amount: number | bigint;
  recipient: PublicKey;
  session: PublicKey;
  rpcOptions?: RpcOptions;
}

/**
 * Parameters for creating a permission for a deposit
 */
export interface CreatePermissionParams {
  user: PublicKey;
  tokenMint: PublicKey;
  payer: PublicKey;
  rpcOptions?: RpcOptions;
  passNotExist?: boolean;
}

/**
 * Parameters for creating a permission for a username deposit
 */
export interface CreateUsernamePermissionParams {
  username: string;
  tokenMint: PublicKey;
  session: PublicKey;
  authority: PublicKey;
  payer: PublicKey;
  rpcOptions?: RpcOptions;
}

/**
 * Parameters for delegating a deposit to an ephemeral rollup
 */
export interface DelegateDepositParams {
  user: PublicKey;
  tokenMint: PublicKey;
  payer: PublicKey;
  validator: PublicKey;
  rpcOptions?: RpcOptions;
  passNotExist?: boolean;
}

/**
 * Parameters for delegating a username deposit to an ephemeral rollup
 */
export interface DelegateUsernameDepositParams {
  username: string;
  tokenMint: PublicKey;
  // session: PublicKey;
  payer: PublicKey;
  validator: PublicKey;
  rpcOptions?: RpcOptions;
  passNotExist?: boolean;
}

/**
 * Parameters for undelegating a deposit from an ephemeral rollup
 */
export interface UndelegateDepositParams {
  user: PublicKey;
  tokenMint: PublicKey;
  payer: PublicKey;
  magicProgram: PublicKey;
  magicContext: PublicKey;
  rpcOptions?: RpcOptions;
}

/**
 * Parameters for undelegating a username deposit from an ephemeral rollup
 */
export interface UndelegateUsernameDepositParams {
  username: string;
  tokenMint: PublicKey;
  session: PublicKey;
  payer: PublicKey;
  magicProgram: PublicKey;
  magicContext: PublicKey;
  rpcOptions?: RpcOptions;
}

export interface UndelegatePermissionParams {
  user: PublicKey;
  tokenMint: PublicKey;
  rpcOptions?: RpcOptions;
}

/**
 * Parameters for transferring between user deposits
 */
export interface TransferDepositParams {
  user: PublicKey;
  tokenMint: PublicKey;
  destinationUser: PublicKey;
  amount: number | bigint;
  payer: PublicKey;
  rpcOptions?: RpcOptions;
}

/**
 * Parameters for transferring from a user deposit to a username deposit
 */
export interface TransferToUsernameDepositParams {
  username: string;
  tokenMint: PublicKey;
  amount: number | bigint;
  user: PublicKey;
  payer: PublicKey;
  rpcOptions?: RpcOptions;
}

/**
 * Delegation record from MagicBlock router
 */
export interface DelegationRecord {
  authority: string;
  owner?: string;
  delegationSlot?: number;
  lamports?: number;
}

/**
 * Response from MagicBlock getDelegationStatus RPC call.
 */
export interface DelegationStatusResult {
  isDelegated: boolean;
  fqdn?: string;
  delegationRecord: DelegationRecord;
}

/**
 * Full JSON-RPC response for getDelegationStatus
 */
export interface DelegationStatusResponse {
  jsonrpc: "2.0";
  id: number | string;
  result: DelegationStatusResult;
  error?: { code: number; message: string } | null;
}

// Type guards for runtime wallet type discrimination

/**
 * Check if signer is a raw Keypair
 */
export function isKeypair(signer: WalletSigner): signer is Keypair {
  return "secretKey" in signer && signer.secretKey instanceof Uint8Array;
}

/**
 * Check if signer is an AnchorProvider
 */
export function isAnchorProvider(
  signer: WalletSigner
): signer is AnchorProvider {
  return "wallet" in signer && "connection" in signer && "opts" in signer;
}

/**
 * Check if signer is a WalletLike (wallet adapter)
 */
export function isWalletLike(signer: WalletSigner): signer is WalletLike {
  return (
    "publicKey" in signer &&
    "signTransaction" in signer &&
    "signAllTransactions" in signer &&
    !isKeypair(signer) &&
    !isAnchorProvider(signer)
  );
}
