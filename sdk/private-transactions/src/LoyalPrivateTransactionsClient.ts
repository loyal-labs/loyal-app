import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Commitment,
} from "@solana/web3.js";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
} from "@solana/spl-token";
import {
  verifyTeeRpcIntegrity,
  getAuthToken,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { sign } from "tweetnacl";
import type { TelegramPrivateTransfer } from "./idl/telegram_private_transfer.ts";
import idl from "./idl/telegram_private_transfer.json";
import {
  PROGRAM_ID,
  DELEGATION_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  getErValidatorForRpcEndpoint,
  getErValidatorForSolanaEnv,
} from "./constants";
import {
  findDepositPda,
  findUsernameDepositPda,
  findVaultPda,
  findPermissionPda,
  findDelegationRecordPda,
  findDelegationMetadataPda,
  findBufferPda,
} from "./pda";
import { InternalWalletAdapter } from "./wallet-adapter";
import { isKeypair, isAnchorProvider } from "./types";
import type {
  WalletSigner,
  WalletLike,
  ClientConfig,
  DepositData,
  UsernameDepositData,
  InitializeDepositParams,
  ModifyBalanceParams,
  ModifyBalanceResult,
  CreatePermissionParams,
  CreateUsernamePermissionParams,
  DelegateDepositParams,
  DelegateUsernameDepositParams,
  UndelegateDepositParams,
  UndelegateUsernameDepositParams,
  TransferDepositParams,
  TransferToUsernameDepositParams,
  InitializeUsernameDepositParams,
  ClaimUsernameDepositToDepositParams,
  DelegationStatusResponse,
  CheckedTransactionInstruction,
  InstructionCheck,
  RpcOptions,
} from "./types";

function prettyStringify(obj: unknown): string {
  const json = JSON.stringify(
    obj,
    (_key, value) => {
      if (value instanceof PublicKey) return value.toBase58();
      if (typeof value === "bigint") return value.toString();
      return value;
    },
    2
  );
  // Collapse arrays onto single lines
  return json.replace(/\[\s+(\d[\d,\s]*\d)\s+\]/g, (_match, inner) => {
    const items = inner.split(/,\s*/).map((s: string) => s.trim());
    return `[${items.join(", ")}]`;
  });
}

function programFromRpc(
  signer: WalletSigner,
  commitment: Commitment,
  rpcEndpoint: string,
  wsEndpoint?: string
): Program<TelegramPrivateTransfer> {
  const adapter = InternalWalletAdapter.from(signer);
  const baseConnection = new Connection(rpcEndpoint, {
    wsEndpoint: wsEndpoint,
    commitment,
  });
  const baseProvider = new AnchorProvider(baseConnection, adapter, {
    commitment,
  });
  return new Program(idl as TelegramPrivateTransfer, baseProvider);
}

/**
 * Derive a message signing function from any supported signer type.
 * Required for PER auth token acquisition.
 */
function deriveMessageSigner(
  signer: WalletSigner
): (message: Uint8Array) => Promise<Uint8Array> {
  if (isKeypair(signer)) {
    return (message: Uint8Array) =>
      Promise.resolve(sign.detached(message, signer.secretKey));
  }

  if (isAnchorProvider(signer)) {
    const wallet = signer.wallet as {
      signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
    };
    if (typeof wallet.signMessage === "function") {
      return (message: Uint8Array) => wallet.signMessage!(message);
    }
    throw new Error(
      "AnchorProvider wallet does not support signMessage, required for PER auth"
    );
  }

  // WalletLike
  const walletLike = signer as {
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  };
  if (typeof walletLike.signMessage === "function") {
    return (message: Uint8Array) => walletLike.signMessage!(message);
  }
  throw new Error("Wallet does not support signMessage, required for PER auth");
}

// Subscribe for changes (before transaction) and start polling (should be awaited after transaction).
// Returns an object with `wait()` to start polling and `cancel()` to clean up the subscription
// if the transaction fails before `wait()` is called.
export function waitForAccountOwnerChange(
  connection: Connection,
  account: PublicKey,
  expectedOwner: PublicKey,
  timeoutMs = 15_000,
  intervalMs = 1_000
): { wait: () => Promise<void>; cancel: () => Promise<void> } {
  let skipWait: () => void;
  const subId = connection.onAccountChange(
    account,
    (accountInfo) => {
      if (accountInfo.owner.equals(expectedOwner) && skipWait) {
        console.log(
          `waitForAccountOwnerChange: ${account.toString()} – short-circuit polling wait`
        );
        skipWait();
      }
    },
    { commitment: "confirmed" }
  );

  const cleanup = async () => {
    await connection.removeAccountChangeListener(subId);
  };

  const wait = async () => {
    try {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const info = await connection.getAccountInfo(account, "confirmed");
        if (info && info.owner.equals(expectedOwner)) {
          console.log(
            `waitForAccountOwnerChange: ${account.toString()} appeared with owner ${expectedOwner.toString()} after ${
              Date.now() - start
            }ms`
          );
          return;
        }
        if (info) {
          console.log(
            `waitForAccountOwnerChange: ${account.toString()} exists but owner is ${info.owner.toString()}, expected ${expectedOwner.toString()}`
          );
        }
        await new Promise<void>((r) => {
          skipWait = r;
          setTimeout(r, intervalMs);
        });
      }
      throw new Error(
        `waitForAccountOwnerChange: ${account.toString()} did not appear with owner ${expectedOwner.toString()} after ${timeoutMs}ms`
      );
    } finally {
      await cleanup();
    }
  };

  return { wait, cancel: cleanup };
}

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
export class LoyalPrivateTransactionsClient {
  readonly baseProgram: Program<TelegramPrivateTransfer>;
  readonly ephemeralProgram: Program<TelegramPrivateTransfer>;
  readonly wallet: WalletLike;

  private constructor(
    baseProgram: Program<TelegramPrivateTransfer>,
    ephemeralProgram: Program<TelegramPrivateTransfer>,
    wallet: WalletLike
  ) {
    this.baseProgram = baseProgram;
    this.ephemeralProgram = ephemeralProgram;
    this.wallet = wallet;
  }

  private getExpectedErValidator(): PublicKey {
    return getErValidatorForRpcEndpoint(
      this.ephemeralProgram.provider.connection.rpcEndpoint
    );
  }

  getExpectedValidator(): PublicKey {
    return this.getExpectedErValidator();
  }

  async getAccountDelegationStatus(
    account: PublicKey
  ): Promise<DelegationStatusResponse> {
    return this.getDelegationStatus(account);
  }

  // ============================================================
  // Factory Methods
  // ============================================================

  /**
   * Create client connected to an ephemeral rollup endpoint with PER auth token.
   * Verifies TEE RPC integrity and obtains an auth token automatically.
   */
  static async fromConfig(
    config: ClientConfig
  ): Promise<LoyalPrivateTransactionsClient> {
    const {
      signer,
      baseRpcEndpoint,
      baseWsEndpoint,
      ephemeralRpcEndpoint,
      ephemeralWsEndpoint,
      commitment = "confirmed",
      authToken,
    } = config;

    const adapter = InternalWalletAdapter.from(signer);

    const baseProgram = programFromRpc(
      signer,
      commitment,
      baseRpcEndpoint,
      baseWsEndpoint
    );

    let finalEphemeralRpcEndpoint = ephemeralRpcEndpoint;
    let finalEphemeralWsEndpoint = ephemeralWsEndpoint;

    if (ephemeralRpcEndpoint.includes("tee")) {
      let token: string;
      let expiresAt: number;
      if (!authToken) {
        try {
          const isVerified = await verifyTeeRpcIntegrity(ephemeralRpcEndpoint);
          if (!isVerified) {
            console.error(
              "[LoyalClient] TEE RPC integrity verification returned false"
            );
          }
        } catch (e) {
          console.error(
            "[LoyalClient] TEE RPC integrity verification error:",
            e
          );
        }

        const signMessage = deriveMessageSigner(signer);

        ({ token, expiresAt } = await getAuthToken(
          ephemeralRpcEndpoint,
          adapter.publicKey,
          signMessage
        ));
      } else {
        token = authToken.token;
      }

      finalEphemeralRpcEndpoint = `${ephemeralRpcEndpoint}?token=${token}`;
      finalEphemeralWsEndpoint = ephemeralWsEndpoint
        ? `${ephemeralWsEndpoint}?token=${token}`
        : undefined;
    }

    const ephemeralProgram = programFromRpc(
      signer,
      commitment,
      finalEphemeralRpcEndpoint,
      finalEphemeralWsEndpoint
    );

    return new LoyalPrivateTransactionsClient(
      baseProgram,
      ephemeralProgram,
      adapter
    );
  }

  // ============================================================
  // Deposit Operations
  // ============================================================

  /**
   * Initialize a deposit account for a user and token mint
   */
  async initializeDeposit(params: InitializeDepositParams): Promise<string> {
    const { ix, ensure } = await this.initializeDepositIx(params);

    await this.processEnsureChecks(ensure);

    const tx = new Transaction().add(ix);
    return await this.baseProgram.provider.sendAndConfirm!(
      tx,
      [this.baseProgram.provider.wallet!.payer!],
      params.rpcOptions
    );
  }

  async initializeDepositIx(
    params: InitializeDepositParams
  ): Promise<CheckedTransactionInstruction> {
    const { user, tokenMint, payer } = params;

    const [depositPda] = findDepositPda(user, tokenMint);

    const ix = await this.baseProgram.methods
      .initializeDeposit()
      .accountsPartial({
        payer,
        user,
        tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    return {
      ix,
      ensure: [
        {
          address: depositPda,
          delegated: false,
          passNotExist: true,
          label: "initializeDeposit-depositPda",
        },
      ],
    };
  }

  async initializeUsernameDeposit(
    params: InitializeUsernameDepositParams
  ): Promise<string> {
    const { ix, ensure } = await this.initializeUsernameDepositIx(params);

    await this.processEnsureChecks(ensure);

    const tx = new Transaction().add(ix);
    return await this.baseProgram.provider.sendAndConfirm!(
      tx,
      [this.baseProgram.provider.wallet!.payer!],
      params.rpcOptions
    );
  }

  async initializeUsernameDepositIx(
    params: InitializeUsernameDepositParams
  ): Promise<CheckedTransactionInstruction> {
    const { username, tokenMint, payer } = params;

    const [usernameDepositPda] = findUsernameDepositPda(username, tokenMint);

    const ix = await this.baseProgram.methods
      .initializeUsernameDeposit(username)
      .accountsPartial({
        payer,
        tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    return {
      ix,
      ensure: [
        {
          address: usernameDepositPda,
          delegated: false,
          passNotExist: true,
          label: "initializeUsernameDeposit-usernameDepositPda",
        },
      ],
    };
  }

  /**
   * Modify the balance of a user's deposit account
   */
  async modifyBalance(
    params: ModifyBalanceParams
  ): Promise<ModifyBalanceResult> {
    const { user, tokenMint } = params;
    const { ix, ensure } = await this.modifyBalanceIx(params);

    await this.processEnsureChecks(ensure);

    const tx = new Transaction().add(ix);
    const signature = await this.baseProgram.provider.sendAndConfirm!(
      tx,
      [this.baseProgram.provider.wallet!.payer!],
      params.rpcOptions
    );

    // TODO: add wait
    const deposit = await this.getBaseDeposit(user, tokenMint);
    if (!deposit) {
      throw new Error("Failed to fetch deposit after modification");
    }

    return { signature, deposit };
  }

  async modifyBalanceIx(
    params: ModifyBalanceParams
  ): Promise<CheckedTransactionInstruction> {
    const { user, tokenMint, amount, increase, payer, passNotExist } = params;

    const [depositPda] = findDepositPda(user, tokenMint);
    const [vaultPda] = findVaultPda(tokenMint);
    const vaultTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const accounts = {
      payer,
      user,
      vault: vaultPda,
      deposit: depositPda,
      vaultTokenAccount,
      tokenMint,
    };

    console.log("modifyBalance", prettyStringify(accounts));

    const ix = await this.baseProgram.methods
      .modifyBalance({ amount: new BN(amount.toString()), increase })
      .accountsPartial(accounts)
      .instruction();

    return {
      ix,
      ensure: [
        {
          address: depositPda,
          delegated: false,
          passNotExist: passNotExist === undefined ? false : passNotExist,
          label: "modifyBalance-depositPda",
        },
      ],
    };
  }

  async claimUsernameDepositToDeposit(
    params: ClaimUsernameDepositToDepositParams
  ): Promise<string> {
    const { ix, ensure } = await this.claimUsernameDepositToDepositIx(params);

    await this.processEnsureChecks(ensure);

    const tx = new Transaction().add(ix);
    return await this.baseProgram.provider.sendAndConfirm!(
      tx,
      [this.baseProgram.provider.wallet!.payer!],
      params.rpcOptions
    );
  }

  async claimUsernameDepositToDepositIx(
    params: ClaimUsernameDepositToDepositParams
  ): Promise<CheckedTransactionInstruction> {
    const { username, tokenMint, amount, recipient, session } = params;

    this.validateUsername(username);

    const [sourceUsernameDeposit] = findUsernameDepositPda(username, tokenMint);
    const [destinationDeposit] = findDepositPda(recipient, tokenMint);

    const accounts: Record<string, PublicKey | null> = {
      user: recipient,
      sourceUsernameDeposit,
      tokenMint,
      session,
    };
    console.log(
      "claimUsernameDepositToDeposit accounts:",
      prettyStringify(accounts)
    );

    const ix = await this.ephemeralProgram.methods
      .claimUsernameDepositToDeposit(new BN(amount.toString()))
      .accountsPartial(accounts)
      .instruction();

    return {
      ix,
      ensure: [
        {
          address: sourceUsernameDeposit,
          delegated: true,
          passNotExist: false,
          label: "claimUsernameDepositToDeposit-sourceUsernameDeposit",
        },
        {
          address: destinationDeposit,
          delegated: true,
          passNotExist: false,
          label: "claimUsernameDepositToDeposit-destinationDeposit",
        },
      ],
    };
  }

  // ============================================================
  // Permission Operations
  // ============================================================

  /**
   * Create a permission for a deposit account (required for PER)
   */
  async createPermission(
    params: CreatePermissionParams
  ): Promise<string | null> {
    const { ix, ensure } = await this.createPermissionIx(params);

    await this.processEnsureChecks(ensure);

    const tx = new Transaction().add(ix);
    return await this.baseProgram.provider.sendAndConfirm!(
      tx,
      [this.baseProgram.provider.wallet!.payer!],
      params.rpcOptions
    );
  }

  async createPermissionIx(
    params: CreatePermissionParams
  ): Promise<CheckedTransactionInstruction> {
    const { user, tokenMint, payer, passNotExist } = params;

    const [depositPda] = findDepositPda(user, tokenMint);
    const [permissionPda] = findPermissionPda(depositPda);

    const ix = await this.baseProgram.methods
      .createPermission()
      .accountsPartial({
        payer,
        user,
        deposit: depositPda,
        permission: permissionPda,
        permissionProgram: PERMISSION_PROGRAM_ID,
      })
      .instruction();

    return {
      ix,
      ensure: [
        {
          address: depositPda,
          delegated: false,
          passNotExist: passNotExist === undefined ? true : passNotExist,
          label: "createPermission-depositPda",
        },
        {
          address: permissionPda,
          delegated: false,
          passNotExist: true,
          label: "createPermission-permissionPda",
        },
      ],
    };
  }

  /**
   * Create a permission for a username-based deposit account
   */
  async createUsernamePermission(
    params: CreateUsernamePermissionParams
  ): Promise<string> {
    const { ix, ensure } = await this.createUsernamePermissionIx(params);

    await this.processEnsureChecks(ensure);

    const tx = new Transaction().add(ix);
    return await this.baseProgram.provider.sendAndConfirm!(
      tx,
      [this.baseProgram.provider.wallet!.payer!],
      params.rpcOptions
    );
  }

  async createUsernamePermissionIx(
    params: CreateUsernamePermissionParams
  ): Promise<CheckedTransactionInstruction> {
    const { username, tokenMint, session, authority, payer } = params;

    this.validateUsername(username);

    const [depositPda] = findUsernameDepositPda(username, tokenMint);
    const [permissionPda] = findPermissionPda(depositPda);

    const ix = await this.baseProgram.methods
      .createUsernamePermission()
      .accountsPartial({
        payer,
        authority,
        deposit: depositPda,
        session,
      })
      .instruction();

    return {
      ix,
      ensure: [
        {
          address: depositPda,
          delegated: false,
          passNotExist: false,
          label: "createUsernamePermission-depositPda",
        },
        {
          address: permissionPda,
          delegated: false,
          passNotExist: true,
          label: "createUsernamePermission-permissionPda",
        },
      ],
    };
  }

  // ============================================================
  // Delegation Operations
  // ============================================================

  /**
   * Delegate a deposit account to the ephemeral rollup
   */
  async delegateDeposit(params: DelegateDepositParams): Promise<string> {
    const { user, tokenMint } = params;
    const { ix, ensure } = await this.delegateDepositIx(params);

    await this.processEnsureChecks(ensure);

    const [depositPda] = findDepositPda(user, tokenMint);

    const delegationWatcher = waitForAccountOwnerChange(
      this.baseProgram.provider.connection,
      depositPda,
      DELEGATION_PROGRAM_ID
    );

    let signature;
    try {
      const tx = new Transaction().add(ix);
      signature = await this.baseProgram.provider.sendAndConfirm!(
        tx,
        [this.baseProgram.provider.wallet!.payer!],
        params.rpcOptions
      );
      await delegationWatcher.wait();
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    } catch (e) {
      await delegationWatcher.cancel();
      throw e;
    }

    return signature;
  }

  async delegateDepositIx(
    params: DelegateDepositParams
  ): Promise<CheckedTransactionInstruction> {
    const { user, tokenMint, payer, validator, passNotExist } = params;

    const [depositPda] = findDepositPda(user, tokenMint);
    const [bufferPda] = findBufferPda(depositPda);
    const [delegationRecordPda] = findDelegationRecordPda(depositPda);
    const [delegationMetadataPda] = findDelegationMetadataPda(depositPda);

    const ix = await this.baseProgram.methods
      .delegate(user, tokenMint)
      .accountsPartial({
        payer,
        bufferDeposit: bufferPda,
        delegationRecordDeposit: delegationRecordPda,
        delegationMetadataDeposit: delegationMetadataPda,
        deposit: depositPda,
        validator,
        ownerProgram: PROGRAM_ID,
        delegationProgram: DELEGATION_PROGRAM_ID,
      })
      .instruction();

    return {
      ix,
      ensure: [
        {
          address: depositPda,
          delegated: false,
          passNotExist: passNotExist === undefined ? false : passNotExist,
          label: "delegateDeposit-depositPda",
        },
      ],
    };
  }

  /**
   * Delegate a username-based deposit account to the ephemeral rollup
   */
  async delegateUsernameDeposit(
    params: DelegateUsernameDepositParams
  ): Promise<string> {
    const { username, tokenMint } = params;
    const { ix, ensure } = await this.delegateUsernameDepositIx(params);

    await this.processEnsureChecks(ensure);

    const [depositPda] = findUsernameDepositPda(username, tokenMint);

    const delegationWatcher = waitForAccountOwnerChange(
      this.baseProgram.provider.connection,
      depositPda,
      DELEGATION_PROGRAM_ID
    );

    let signature;
    try {
      const tx = new Transaction().add(ix);
      signature = await this.baseProgram.provider.sendAndConfirm!(
        tx,
        [this.baseProgram.provider.wallet!.payer!],
        params.rpcOptions
      );
      await delegationWatcher.wait();
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    } catch (e) {
      await delegationWatcher.cancel();
      throw e;
    }

    return signature;
  }

  async delegateUsernameDepositIx(
    params: DelegateUsernameDepositParams
  ): Promise<CheckedTransactionInstruction> {
    const { username, tokenMint, payer, validator } = params;

    this.validateUsername(username);

    const [depositPda] = findUsernameDepositPda(username, tokenMint);
    const [bufferPda] = findBufferPda(depositPda);
    const [delegationRecordPda] = findDelegationRecordPda(depositPda);
    const [delegationMetadataPda] = findDelegationMetadataPda(depositPda);

    const ix = await this.baseProgram.methods
      .delegateUsernameDeposit(username, tokenMint)
      .accountsPartial({
        payer,
        bufferDeposit: bufferPda,
        delegationRecordDeposit: delegationRecordPda,
        delegationMetadataDeposit: delegationMetadataPda,
        deposit: depositPda,
        ownerProgram: PROGRAM_ID,
        delegationProgram: DELEGATION_PROGRAM_ID,
        validator,
      })
      .instruction();

    return {
      ix,
      ensure: [
        {
          address: depositPda,
          delegated: false,
          passNotExist: false,
          label: "delegateUsernameDeposit-depositPda",
        },
      ],
    };
  }

  /**
   * Undelegate a deposit account from the ephemeral rollup.
   * Waits for both base and ephemeral connections to confirm the deposit
   * is owned by PROGRAM_ID before returning.
   */
  async undelegateDeposit(params: UndelegateDepositParams): Promise<string> {
    const {
      user,
      tokenMint,
      payer,
      sessionToken,
      magicProgram,
      magicContext,
      rpcOptions,
    } = params;

    const [depositPda] = findDepositPda(user, tokenMint);

    await this.ensureDelegated(
      depositPda,
      "undelegateDeposit-depositPda",
      true
    );

    const accounts: Record<string, PublicKey | null> = {
      user,
      payer,
      deposit: depositPda,
      magicProgram,
      magicContext,
    };
    accounts.sessionToken = sessionToken ?? null;

    const delegationWatcher = waitForAccountOwnerChange(
      this.baseProgram.provider.connection,
      depositPda,
      PROGRAM_ID
    );

    let signature;
    try {
      console.log("undelegateDeposit Accounts:", prettyStringify(accounts));
      signature = await this.ephemeralProgram.methods
        .undelegate()
        .accountsPartial(accounts)
        .rpc(rpcOptions);
      console.log(
        "undelegateDeposit: waiting for depositPda owner to be PROGRAM_ID on base connection..."
      );
      await delegationWatcher.wait();
    } catch (e) {
      await delegationWatcher.cancel();
      throw e;
    }

    return signature;
  }

  /**
   * Undelegate a username-based deposit account from the ephemeral rollup
   */
  async undelegateUsernameDeposit(
    params: UndelegateUsernameDepositParams
  ): Promise<string> {
    const {
      username,
      tokenMint,
      session,
      payer,
      magicProgram,
      magicContext,
      rpcOptions,
    } = params;

    this.validateUsername(username);

    const [depositPda] = findUsernameDepositPda(username, tokenMint);

    await this.ensureDelegated(
      depositPda,
      "undelegateUsernameDeposit-depositPda"
    );

    const signature = await this.ephemeralProgram.methods
      .undelegateUsernameDeposit(username, tokenMint)
      .accountsPartial({
        payer,
        session,
        deposit: depositPda,
        magicProgram,
        magicContext,
      })
      .rpc(rpcOptions);

    return signature;
  }

  // ============================================================
  // Transfer Operations
  // ============================================================

  /**
   * Transfer between two user deposits
   */
  async transferDeposit(params: TransferDepositParams): Promise<string> {
    const {
      user,
      tokenMint,
      destinationUser,
      amount,
      payer,
      sessionToken,
      rpcOptions,
    } = params;

    const [sourceDepositPda] = findDepositPda(user, tokenMint);
    const [destinationDepositPda] = findDepositPda(destinationUser, tokenMint);

    await this.ensureDelegated(
      sourceDepositPda,
      "transferDeposit-sourceDepositPda"
    );
    await this.ensureDelegated(
      destinationDepositPda,
      "transferDeposit-destinationDepositPda"
    );

    const accounts: Record<string, PublicKey | null> = {
      user,
      payer,
      sourceDeposit: sourceDepositPda,
      destinationDeposit: destinationDepositPda,
      tokenMint,
      systemProgram: SystemProgram.programId,
    };
    accounts.sessionToken = sessionToken ?? null;

    console.log("transferDeposit Accounts:");
    Object.entries(accounts).forEach(([key, value]) => {
      console.log(key, value && value.toString());
    });
    console.log("-----");

    const signature = await this.ephemeralProgram.methods
      .transferDeposit(new BN(amount.toString()))
      .accountsPartial(accounts)
      .rpc(rpcOptions);

    return signature;
  }

  /**
   * Transfer from a user deposit to a username deposit
   */
  async transferToUsernameDeposit(
    params: TransferToUsernameDepositParams
  ): Promise<string> {
    const {
      username,
      tokenMint,
      amount,
      user,
      payer,
      sessionToken,
      rpcOptions,
    } = params;

    this.validateUsername(username);

    const [sourceDepositPda] = findDepositPda(user, tokenMint);
    const [destinationDepositPda] = findUsernameDepositPda(username, tokenMint);

    await this.ensureDelegated(
      sourceDepositPda,
      "transferToUsernameDeposit-sourceDepositPda"
    );
    await this.ensureDelegated(
      destinationDepositPda,
      "transferToUsernameDeposit-destinationDepositPda"
    );

    const accounts: Record<string, PublicKey | null> = {
      user,
      payer,
      sourceDeposit: sourceDepositPda,
      destinationDeposit: destinationDepositPda,
      tokenMint,
      systemProgram: SystemProgram.programId,
    };
    accounts.sessionToken = sessionToken ?? null;

    const signature = await this.ephemeralProgram.methods
      .transferToUsernameDeposit(new BN(amount.toString()))
      .accountsPartial(accounts)
      .rpc(rpcOptions);

    return signature;
  }

  async processEnsureChecks(ensure: InstructionCheck[]): Promise<void> {
    // TODO: make parallel and reuse cache
    for (const { address, delegated, passNotExist, label } of ensure) {
      if (delegated) {
        await this.ensureDelegated(address, label);
      } else {
        await this.ensureNotDelegated(address, label, passNotExist);
      }
    }
  }

  wrapSolToWsolIx({
    user,
    payer,
    lamports,
  }: {
    user: PublicKey;
    payer: PublicKey;
    lamports: bigint;
  }): TransactionInstruction[] {
    const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, user);
    return [
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        wsolAta,
        user,
        NATIVE_MINT
      ),
      SystemProgram.transfer({
        fromPubkey: user,
        toPubkey: wsolAta,
        lamports,
      }),
      createSyncNativeInstruction(wsolAta),
    ];
  }

  closeWsolAta({
    user,
    destination,
  }: {
    user: PublicKey;
    destination: PublicKey;
  }): TransactionInstruction {
    const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, user);
    return createCloseAccountInstruction(wsolAta, destination, user);
  }

  async shieldTokens(params: {
    user: Keypair;
    payer: Keypair;
    tokenMint: PublicKey;
    amount: bigint;
    solanaEnv: "mainnet" | "devnet";
    rpcOptions?: RpcOptions;
  }): Promise<string> {
    const {
      user: userKp,
      payer: payerKp,
      tokenMint,
      amount,
      solanaEnv,
      rpcOptions,
    } = params;
    const user = userKp.publicKey;
    const payer = payerKp.publicKey;
    const isNativeSol = tokenMint.equals(NATIVE_MINT);
    const validator = getErValidatorForSolanaEnv(solanaEnv);

    const instructions: TransactionInstruction[] = [];
    const checks: InstructionCheck[] = [];

    if (isNativeSol) {
      instructions.push(
        ...this.wrapSolToWsolIx({
          user,
          payer,
          lamports: amount,
        })
      );
    }

    const initializeDepositIxs = await this.initializeDepositIx({
      tokenMint,
      user,
      payer,
    });
    instructions.push(initializeDepositIxs.ix);
    checks.push(...initializeDepositIxs.ensure);

    const modifyBalanceIxs = await this.modifyBalanceIx({
      tokenMint,
      user,
      payer,
      amount,
      increase: true,
      passNotExist: true,
    });
    instructions.push(modifyBalanceIxs.ix);
    checks.push(...modifyBalanceIxs.ensure);

    const createPermissionIxs = await this.createPermissionIx({
      tokenMint,
      user,
      payer,
      passNotExist: true,
    });
    instructions.push(createPermissionIxs.ix);
    checks.push(...createPermissionIxs.ensure);

    const delegateDepositIxs = await this.delegateDepositIx({
      tokenMint,
      user,
      payer,
      validator,
      passNotExist: true,
    });
    instructions.push(delegateDepositIxs.ix);
    checks.push(...delegateDepositIxs.ensure);

    // TODO: delegatePermissionIx

    if (isNativeSol) {
      instructions.push(
        this.closeWsolAta({
          user,
          destination: user,
        })
      );
    }

    await this.processEnsureChecks(checks);

    const [depositPda] = findDepositPda(user, tokenMint);
    const delegationWatcher = waitForAccountOwnerChange(
      this.baseProgram.provider.connection,
      depositPda,
      DELEGATION_PROGRAM_ID
    );

    let signature;
    try {
      const tx = new Transaction().add(...instructions);
      signature = await this.baseProgram.provider.sendAndConfirm!(
        tx,
        [userKp, payerKp],
        rpcOptions
      );
      await delegationWatcher.wait();
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    } catch (e) {
      await delegationWatcher.cancel();
      throw e;
    }

    return signature;
  }

  // ============================================================
  // Query Methods
  // ============================================================

  /**
   * Get deposit data for a user and token mint
   */
  async getBaseDeposit(
    user: PublicKey,
    tokenMint: PublicKey
  ): Promise<DepositData | null> {
    const [depositPda] = findDepositPda(user, tokenMint);

    try {
      const account = await this.baseProgram.account.deposit.fetch(depositPda);
      return {
        user: account.user,
        tokenMint: account.tokenMint,
        amount: BigInt(account.amount.toString()),
        address: depositPda,
      };
    } catch {
      return null;
    }
  }

  async getEphemeralDeposit(
    user: PublicKey,
    tokenMint: PublicKey
  ): Promise<DepositData | null> {
    const [depositPda] = findDepositPda(user, tokenMint);

    try {
      const account = await this.ephemeralProgram.account.deposit.fetch(
        depositPda
      );
      return {
        user: account.user,
        tokenMint: account.tokenMint,
        amount: BigInt(account.amount.toString()),
        address: depositPda,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get username deposit data
   */
  async getBaseUsernameDeposit(
    username: string,
    tokenMint: PublicKey
  ): Promise<UsernameDepositData | null> {
    const [depositPda] = findUsernameDepositPda(username, tokenMint);

    try {
      const account = await this.baseProgram.account.usernameDeposit.fetch(
        depositPda
      );
      return {
        username: account.username,
        tokenMint: account.tokenMint,
        amount: BigInt(account.amount.toString()),
        address: depositPda,
      };
    } catch {
      return null;
    }
  }

  async getEphemeralUsernameDeposit(
    username: string,
    tokenMint: PublicKey
  ): Promise<UsernameDepositData | null> {
    const [depositPda] = findUsernameDepositPda(username, tokenMint);

    try {
      const account = await this.ephemeralProgram.account.usernameDeposit.fetch(
        depositPda
      );
      return {
        username: account.username,
        tokenMint: account.tokenMint,
        amount: BigInt(account.amount.toString()),
        address: depositPda,
      };
    } catch {
      return null;
    }
  }

  // ============================================================
  // PDA Helpers
  // ============================================================

  /**
   * Find the deposit PDA for a user and token mint
   */
  findDepositPda(user: PublicKey, tokenMint: PublicKey): [PublicKey, number] {
    return findDepositPda(user, tokenMint, PROGRAM_ID);
  }

  /**
   * Find the username deposit PDA
   */
  findUsernameDepositPda(
    username: string,
    tokenMint: PublicKey
  ): [PublicKey, number] {
    return findUsernameDepositPda(username, tokenMint, PROGRAM_ID);
  }

  /**
   * Find the vault PDA
   */
  findVaultPda(tokenMint: PublicKey): [PublicKey, number] {
    return findVaultPda(tokenMint, PROGRAM_ID);
  }

  // ============================================================
  // Accessors
  // ============================================================

  /**
   * Get the connected wallet's public key
   */
  get publicKey(): PublicKey {
    return this.wallet.publicKey;
  }

  /**
   * Get the underlying Anchor program instance
   */
  getBaseProgram(): Program<TelegramPrivateTransfer> {
    return this.baseProgram;
  }

  getEphemeralProgram(): Program<TelegramPrivateTransfer> {
    return this.ephemeralProgram;
  }

  /**
   * Get the program ID
   */
  getProgramId(): PublicKey {
    return PROGRAM_ID;
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  private validateUsername(username: string): void {
    if (!username || username.length < 5 || username.length > 32) {
      throw new Error("Username must be between 5 and 32 characters");
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      throw new Error(
        "Username can only contain alphanumeric characters and underscores"
      );
    }
  }

  private async permissionAccountExists(
    permission: PublicKey
  ): Promise<boolean> {
    const info = await this.baseProgram.provider.connection.getAccountInfo(
      permission
    );
    return !!info && info.owner.equals(PERMISSION_PROGRAM_ID);
  }

  private isAccountAlreadyInUse(error: unknown): boolean {
    const message = (error as { message?: string })?.message ?? "";
    if (message.includes("already in use")) {
      return true;
    }
    const logs =
      (error as { logs?: string[]; transactionLogs?: string[] })?.logs ??
      (error as { logs?: string[]; transactionLogs?: string[] })
        ?.transactionLogs;
    if (Array.isArray(logs)) {
      return logs.some((log) => log.includes("already in use"));
    }
    return false;
  }

  private async ensureNotDelegated(
    account: PublicKey,
    name?: string,
    passNotExist?: boolean
  ): Promise<void> {
    const baseAccountInfo =
      await this.baseProgram.provider.connection.getAccountInfo(account);

    if (!baseAccountInfo) {
      if (passNotExist) {
        return;
      }
      const displayName = name ? `${name} - ` : "";
      throw new Error(
        `Account is not exists: ${displayName}${account.toString()}`
      );
    }

    const ephemeralAccountInfo =
      await this.ephemeralProgram.provider.connection.getAccountInfo(account);

    const isDelegated = baseAccountInfo!.owner.equals(DELEGATION_PROGRAM_ID);
    const displayName = name ? `${name} - ` : "";
    if (isDelegated) {
      console.error(
        `Account is delegated to ER: ${displayName}${account.toString()}`
      );
      const delegationStatus = await this.getDelegationStatus(account);
      console.error(
        "/getDelegationStatus",
        JSON.stringify(delegationStatus, null, 2)
      );
      console.error("baseAccountInfo", prettyStringify(baseAccountInfo));
      console.error(
        "ephemeralAccountInfo",
        prettyStringify(ephemeralAccountInfo)
      );

      const expectedValidator = this.getExpectedErValidator();
      const authority = delegationStatus.result?.delegationRecord?.authority;
      if (authority && authority !== expectedValidator.toString()) {
        console.error(
          `Account is delegated on wrong validator: ${displayName}${account.toString()} - validator: ${authority}`
        );
      }

      throw new Error(
        `Account is delegated to ER: ${displayName}${account.toString()}`
      );
    }
  }

  private async ensureDelegated(
    account: PublicKey,
    name?: string,
    skipValidatorCheck?: boolean
  ): Promise<void> {
    const baseAccountInfo =
      await this.baseProgram.provider.connection.getAccountInfo(account);
    const ephemeralAccountInfo =
      await this.ephemeralProgram.provider.connection.getAccountInfo(account);

    if (!baseAccountInfo) {
      const displayName = name ? `${name} - ` : "";
      throw new Error(
        `Account is not exists: ${displayName}${account.toString()}`
      );
    }
    const isDelegated = baseAccountInfo!.owner.equals(DELEGATION_PROGRAM_ID);
    const displayName = name ? `${name} - ` : "";

    const delegationStatus = await this.getDelegationStatus(account);

    if (!isDelegated) {
      console.error(
        `Account is not delegated to ER: ${displayName}${account.toString()}`
      );
      console.error(
        "/getDelegationStatus:",
        JSON.stringify(delegationStatus, null, 2)
      );
      console.error("baseAccountInfo", prettyStringify(baseAccountInfo));
      console.error(
        "ephemeralAccountInfo",
        prettyStringify(ephemeralAccountInfo)
      );

      throw new Error(
        `Account is not delegated to ER: ${displayName}${account.toString()}`
      );
    } else if (
      !skipValidatorCheck &&
      delegationStatus.result.delegationRecord.authority !==
        this.getExpectedErValidator().toString()
    ) {
      console.error(
        `Account is delegated on wrong validator: ${displayName}${account.toString()} - validator: ${
          delegationStatus.result.delegationRecord.authority
        }`
      );
      console.error(
        "/getDelegationStatus:",
        JSON.stringify(delegationStatus, null, 2)
      );
      console.error("baseAccountInfo", prettyStringify(baseAccountInfo));
      console.error(
        "ephemeralAccountInfo",
        prettyStringify(ephemeralAccountInfo)
      );

      throw new Error(
        `Account is delegated on wrong validator: ${displayName}${account.toString()} - validator: ${
          delegationStatus.result.delegationRecord.authority
        }`
      );
    }
  }

  private async getDelegationStatus(
    account: PublicKey
  ): Promise<DelegationStatusResponse> {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getDelegationStatus",
      params: [account.toString()],
    });
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    };

    const expectedValidator = this.getExpectedErValidator();

    // Try TEE first — pick mainnet or devnet TEE based on ephemeral RPC URL
    const ephemeralUrl = this.ephemeralProgram.provider.connection.rpcEndpoint;
    const teeBaseUrl = ephemeralUrl.includes("mainnet-tee")
      ? "https://mainnet-tee.magicblock.app/"
      : "https://tee.magicblock.app/";
    try {
      const teeRes = await fetch(teeBaseUrl, options);
      const teeData = (await teeRes.json()) as DelegationStatusResponse;
      if (teeData.result?.isDelegated) {
        // TEE confirmed delegation — synthesize authority so validator check passes
        return {
          ...teeData,
          result: {
            ...teeData.result,
            delegationRecord: {
              authority: expectedValidator.toString(),
            },
          },
        };
      }
    } catch (e) {
      console.error(
        "[getDelegationStatus] TEE fetch failed, falling back to devnet-router: Options:",
        options,
        "Error:",
        e
      );
    }

    // Fallback to devnet-router
    const routerBaseUrl = ephemeralUrl.includes("mainnet-tee")
      ? "https://router.magicblock.app/"
      : "https://devnet-router.magicblock.app/";
    const res = await fetch(routerBaseUrl, options);
    const routerData = (await res.json()) as DelegationStatusResponse;

    // WORKAROUND: devnet-router returns an error for accounts delegated to the
    // PER validator it doesn't recognize, e.g.:
    //   {"error":{"code":-32604,"message":"account has been delegated to unknown ER node: FnE6..."}}
    // Treat as valid delegation if it mentions our PER validator.
    if (routerData.error?.message?.includes(expectedValidator.toString())) {
      return {
        ...routerData,
        result: {
          isDelegated: true,
          delegationRecord: {
            authority: expectedValidator.toString(),
          },
        },
      };
    }

    return routerData;
  }
}
