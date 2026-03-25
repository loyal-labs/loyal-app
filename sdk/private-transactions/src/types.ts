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

/**
 * Data structure for a username-based deposit account
 */
export interface UsernameDepositData {
  username: string;
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
}

/**
 * Parameters for undelegating a deposit from an ephemeral rollup
 */
export interface UndelegateDepositParams {
  user: PublicKey;
  tokenMint: PublicKey;
  payer: PublicKey;
  sessionToken?: PublicKey | null;
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

/**
 * Parameters for transferring between user deposits
 */
export interface TransferDepositParams {
  user: PublicKey;
  tokenMint: PublicKey;
  destinationUser: PublicKey;
  amount: number | bigint;
  payer: PublicKey;
  sessionToken?: PublicKey | null;
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
  sessionToken?: PublicKey | null;
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
