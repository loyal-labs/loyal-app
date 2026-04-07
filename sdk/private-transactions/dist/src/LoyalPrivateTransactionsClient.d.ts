import { Connection, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import type { TelegramPrivateTransfer } from "./idl/telegram_private_transfer.ts";
import type { WalletLike, ClientConfig, DepositData, UsernameDepositData, InitializeDepositParams, ModifyBalanceParams, ModifyBalanceResult, CreatePermissionParams, CreateUsernamePermissionParams, DelegateDepositParams, DelegateUsernameDepositParams, UndelegateDepositParams, UndelegateUsernameDepositParams, TransferDepositParams, TransferToUsernameDepositParams, InitializeUsernameDepositParams, ClaimUsernameDepositToDepositParams, DelegationStatusResponse } from "./types";
export declare function waitForAccountOwnerChange(connection: Connection, account: PublicKey, expectedOwner: PublicKey, timeoutMs?: number, intervalMs?: number): {
    wait: () => Promise<void>;
    cancel: () => Promise<void>;
};
/**
 * LoyalPrivateTransactionsClient - SDK for interacting with the Telegram Private Transfer program
 * with MagicBlock PER (Private Ephemeral Rollups) support
 *
 * @example
 * // Create one client with both base + ephemeral endpoints
 * const client = await LoyalPrivateTransactionsClient.fromConfig({
 *   signer: keypair,
 *   baseRpcEndpoint: "https://api.devnet.solana.com",
 *   ephemeralRpcEndpoint: "https://mainnet-tee.magicblock.app",
 *   ephemeralWsEndpoint: "wss://mainnet-tee.magicblock.app",
 * });
 *
 * // Base-layer setup
 * await client.initializeDeposit({ user, tokenMint, payer });
 * await client.modifyBalance({ user, tokenMint, amount: 1000000, increase: true, ... });
 * await client.createPermission({ user, tokenMint, payer });
 * await client.delegateDeposit({ user, tokenMint, payer, validator });
 *
 * // Private transfer on delegated account
 * await client.transferToUsernameDeposit({ username, tokenMint, amount, ... });
 *
 * // Commit and undelegate back to base
 * await client.undelegateDeposit({ user, tokenMint, ... });
 */
export declare class LoyalPrivateTransactionsClient {
    readonly baseProgram: Program<TelegramPrivateTransfer>;
    readonly ephemeralProgram: Program<TelegramPrivateTransfer>;
    readonly wallet: WalletLike;
    private constructor();
    private getExpectedErValidator;
    getExpectedValidator(): PublicKey;
    getAccountDelegationStatus(account: PublicKey): Promise<DelegationStatusResponse>;
    /**
     * Create client connected to an ephemeral rollup endpoint with PER auth token.
     * Verifies TEE RPC integrity and obtains an auth token automatically.
     */
    static fromConfig(config: ClientConfig): Promise<LoyalPrivateTransactionsClient>;
    /**
     * Initialize a deposit account for a user and token mint
     */
    initializeDeposit(params: InitializeDepositParams): Promise<string>;
    initializeUsernameDeposit(params: InitializeUsernameDepositParams): Promise<string>;
    /**
     * Modify the balance of a user's deposit account
     */
    modifyBalance(params: ModifyBalanceParams): Promise<ModifyBalanceResult>;
    claimUsernameDepositToDeposit(params: ClaimUsernameDepositToDepositParams): Promise<string>;
    /**
     * Create a permission for a deposit account (required for PER)
     */
    createPermission(params: CreatePermissionParams): Promise<string | null>;
    /**
     * Create a permission for a username-based deposit account
     */
    createUsernamePermission(params: CreateUsernamePermissionParams): Promise<string | null>;
    /**
     * Delegate a deposit account to the ephemeral rollup
     */
    delegateDeposit(params: DelegateDepositParams): Promise<string>;
    /**
     * Delegate a username-based deposit account to the ephemeral rollup
     */
    delegateUsernameDeposit(params: DelegateUsernameDepositParams): Promise<string>;
    /**
     * Undelegate a deposit account from the ephemeral rollup.
     * Waits for both base and ephemeral connections to confirm the deposit
     * is owned by PROGRAM_ID before returning.
     */
    undelegateDeposit(params: UndelegateDepositParams): Promise<string>;
    /**
     * Undelegate a username-based deposit account from the ephemeral rollup
     */
    undelegateUsernameDeposit(params: UndelegateUsernameDepositParams): Promise<string>;
    /**
     * Transfer between two user deposits
     */
    transferDeposit(params: TransferDepositParams): Promise<string>;
    /**
     * Transfer from a user deposit to a username deposit
     */
    transferToUsernameDeposit(params: TransferToUsernameDepositParams): Promise<string>;
    /**
     * Get deposit data for a user and token mint
     */
    getBaseDeposit(user: PublicKey, tokenMint: PublicKey): Promise<DepositData | null>;
    getEphemeralDeposit(user: PublicKey, tokenMint: PublicKey): Promise<DepositData | null>;
    /**
     * Get username deposit data
     */
    getBaseUsernameDeposit(username: string, tokenMint: PublicKey): Promise<UsernameDepositData | null>;
    getEphemeralUsernameDeposit(username: string, tokenMint: PublicKey): Promise<UsernameDepositData | null>;
    /**
     * Get the live base lending APY for the configured Kamino reserve in basis points.
     * This is reserve supply APY only and does not include farm reward APY.
     * Returns null when the token mint has no hardcoded Kamino reserve config.
     * Devnet reserves intentionally return 0 because the UI APY source is mainnet-only.
     */
    getKaminoLendingApyBps(tokenMint: PublicKey): Promise<number | null>;
    /**
     * Get the connected wallet's public key
     */
    get publicKey(): PublicKey;
    /**
     * Get the underlying Anchor program instance
     */
    getBaseProgram(): Program<TelegramPrivateTransfer>;
    getEphemeralProgram(): Program<TelegramPrivateTransfer>;
    /**
     * Get the program ID
     */
    getProgramId(): PublicKey;
    private validateUsername;
    private permissionAccountExists;
    private isAccountAlreadyInUse;
    private ensureNotDelegated;
    private ensureDelegated;
    private getDelegationStatus;
}
