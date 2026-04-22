import {
  Connection,
  PublicKey,
  SystemProgram,
  type Commitment,
} from "@solana/web3.js";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  verifyTeeRpcIntegrity,
  getAuthToken,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import type { TelegramPrivateTransfer } from "./idl/telegram_private_transfer.ts";
import idl from "./idl/telegram_private_transfer.json";
import {
  PROGRAM_ID,
  DELEGATION_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  getErValidatorForRpcEndpoint,
  getKaminoModifyBalanceAccountsForTokenMint,
  isKaminoMainnetModifyBalanceAccounts,
} from "./constants";
import {
  calculateKaminoShareAmountForLiquidityAmountRaw,
  calculateKaminoCollateralExchangeRateSfFromAmounts,
  calculateKaminoCollateralValuation,
  fetchKaminoReserveSnapshot,
} from "./kamino";
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
  GetKaminoShieldedBalanceQuoteParams,
  GetKaminoCollateralSharesForLiquidityAmountParams,
  KaminoReserveSnapshot,
  KaminoShieldedBalanceQuote,
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
} from "./types";
import { sha256hash } from "./utils";
import { createKeypairMessageSigner } from "./webcrypto";

const KAMINO_API_BASE_URL = "https://api.kamino.finance";
const KAMINO_MAINNET_ENV = "mainnet-beta";
const KAMINO_DEVNET_ENV = "devnet";

type KaminoReserveMetricsResponseItem = {
  reserve: string;
  supplyApy: number | string;
};

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

function getKaminoApiEnv(
  accounts: ReturnType<typeof getKaminoModifyBalanceAccountsForTokenMint>
): string {
  return accounts && isKaminoMainnetModifyBalanceAccounts(accounts)
    ? KAMINO_MAINNET_ENV
    : KAMINO_DEVNET_ENV;
}

function normalizeBigInt(value: number | bigint): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Expected a non-negative integer amount, received ${value}`);
  }

  return BigInt(value);
}

async function fetchKaminoReserveMetrics(args: {
  lendingMarket: PublicKey;
  reserve: PublicKey;
  env: string;
}): Promise<KaminoReserveMetricsResponseItem> {
  const url = new URL(
    `/kamino-market/${args.lendingMarket.toBase58()}/reserves/metrics`,
    KAMINO_API_BASE_URL
  );
  url.searchParams.set("env", args.env);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Kamino reserve metrics request failed with status ${response.status}`
    );
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    throw new Error("Kamino reserve metrics response was not an array");
  }

  const reserveAddress = args.reserve.toBase58();
  const reserveMetrics = payload.find(
    (item): item is KaminoReserveMetricsResponseItem => {
      if (!item || typeof item !== "object") {
        return false;
      }

      const candidate = item as Record<string, unknown>;
      return (
        candidate.reserve === reserveAddress &&
        (typeof candidate.supplyApy === "number" ||
          typeof candidate.supplyApy === "string")
      );
    }
  );

  if (!reserveMetrics) {
    throw new Error(
      `Kamino reserve metrics not found for reserve ${reserveAddress}`
    );
  }

  return reserveMetrics;
}

async function fetchKaminoReserveSupplyApyBps(args: {
  lendingMarket: PublicKey;
  reserve: PublicKey;
  env: string;
}): Promise<number> {
  const reserveMetrics = await fetchKaminoReserveMetrics(args);
  const supplyApy = Number(reserveMetrics.supplyApy);
  if (!Number.isFinite(supplyApy) || supplyApy < 0) {
    throw new Error(
      `Kamino reserve metrics returned an invalid supplyApy for reserve ${args.reserve.toBase58()}`
    );
  }

  return Math.round(supplyApy * 10_000);
}

/**
 * Derive a message signing function from any supported signer type.
 * Required for PER auth token acquisition.
 */
function deriveMessageSigner(
  signer: WalletSigner
): (message: Uint8Array) => Promise<Uint8Array> {
  if (isKeypair(signer)) {
    return createKeypairMessageSigner(signer);
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
    const { user, tokenMint, payer, rpcOptions } = params;

    const [depositPda] = findDepositPda(user, tokenMint);

    await this.ensureNotDelegated(depositPda, "modifyBalance-depositPda", true);

    const signature = await this.baseProgram.methods
      .initializeDeposit()
      .accountsPartial({
        payer,
        user,
        tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc(rpcOptions);

    return signature;
  }

  async initializeUsernameDeposit(
    params: InitializeUsernameDepositParams
  ): Promise<string> {
    const { username, tokenMint, payer, rpcOptions } = params;

    this.validateUsername(username);

    const [usernameDepositPda] = await findUsernameDepositPda(
      username,
      tokenMint
    );

    await this.ensureNotDelegated(
      usernameDepositPda,
      "modifyBalance-depositPda",
      true
    );

    const usernameHash = await sha256hash(username);

    const signature = await this.baseProgram.methods
      .initializeUsernameDeposit(usernameHash)
      .accountsPartial({
        payer,
        tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc(rpcOptions);

    return signature;
  }

  /**
   * Modify the balance of a user's deposit account
   */
  async modifyBalance(
    params: ModifyBalanceParams
  ): Promise<ModifyBalanceResult> {
    const {
      user,
      tokenMint,
      amount,
      increase,
      payer,
      userTokenAccount,
      rpcOptions,
    } = params;

    const [depositPda] = findDepositPda(user, tokenMint);

    await this.ensureNotDelegated(depositPda, "modifyBalance-depositPda");

    const [vaultPda] = findVaultPda(tokenMint);
    const vaultTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const kaminoAccounts = getKaminoModifyBalanceAccountsForTokenMint(tokenMint);
    const vaultCollateralTokenAccount = kaminoAccounts
      ? getAssociatedTokenAddressSync(
          kaminoAccounts.reserveCollateralMint,
          vaultPda,
          true,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      : null;

    console.log("modifyBalance", {
      payer: payer.toString(),
      user: user.toString(),
      vault: vaultPda.toString(),
      deposit: depositPda.toString(),
      userTokenAccount: userTokenAccount.toString(),
      vaultTokenAccount: vaultTokenAccount.toString(),
      tokenMint: tokenMint.toString(),
      kaminoAccounts: kaminoAccounts
        ? {
            lendingMarket: kaminoAccounts.lendingMarket.toString(),
            lendingMarketAuthority:
              kaminoAccounts.lendingMarketAuthority.toString(),
            reserve: kaminoAccounts.reserve.toString(),
            reserveLiquiditySupply:
              kaminoAccounts.reserveLiquiditySupply.toString(),
            reserveCollateralMint:
              kaminoAccounts.reserveCollateralMint.toString(),
            vaultCollateralTokenAccount:
              vaultCollateralTokenAccount?.toString() ?? null,
          }
        : null,
    });

    let methodBuilder = this.baseProgram.methods
      .modifyBalance({ amount: new BN(amount.toString()), increase })
      .accountsPartial({
        payer,
        user,
        vault: vaultPda,
        deposit: depositPda,
        userTokenAccount,
        vaultTokenAccount,
        tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      });

    if (kaminoAccounts && vaultCollateralTokenAccount) {
      methodBuilder = methodBuilder.remainingAccounts([
        {
          pubkey: kaminoAccounts.lendingMarket,
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: kaminoAccounts.lendingMarketAuthority,
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: kaminoAccounts.reserve,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: kaminoAccounts.reserveLiquiditySupply,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: kaminoAccounts.reserveCollateralMint,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: vaultCollateralTokenAccount,
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: kaminoAccounts.instructionSysvarAccount,
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: kaminoAccounts.klendProgram,
          isSigner: false,
          isWritable: false,
        },
      ]);
    }

    const signature = await methodBuilder.rpc(rpcOptions);

    const deposit = await this.getBaseDeposit(user, tokenMint);
    if (!deposit) {
      throw new Error("Failed to fetch deposit after modification");
    }

    return { signature, deposit };
  }

  async claimUsernameDepositToDeposit(
    params: ClaimUsernameDepositToDepositParams
  ): Promise<string> {
    const { username, tokenMint, amount, recipient, session, rpcOptions } =
      params;

    this.validateUsername(username);

    const [sourceUsernameDeposit] = await findUsernameDepositPda(
      username,
      tokenMint
    );
    const [destinationDeposit] = findDepositPda(recipient, tokenMint);

    await this.ensureDelegated(
      sourceUsernameDeposit,
      "claimUsernameDepositToDeposit-sourceUsernameDeposit"
    );
    await this.ensureDelegated(
      destinationDeposit,
      "claimUsernameDepositToDeposit-destinationDeposit"
    );

    const accounts: Record<string, PublicKey | null> = {
      user: recipient,
      sourceUsernameDeposit,
      destinationDeposit,
      tokenMint,
      session,
      tokenProgram: TOKEN_PROGRAM_ID,
    };
    console.log(
      "claimUsernameDepositToDeposit accounts:",
      prettyStringify(accounts)
    );

    // Fetch and log account info for debugging
    const connection = this.baseProgram.provider.connection;
    const [srcInfo, dstInfo, sessionInfo] = await Promise.all([
      connection.getAccountInfo(sourceUsernameDeposit),
      connection.getAccountInfo(destinationDeposit),
      connection.getAccountInfo(session),
    ]);
    console.log(
      "claimUsernameDepositToDeposit sourceUsernameDeposit accountInfo:",
      prettyStringify({
        address: sourceUsernameDeposit.toBase58(),
        exists: !!srcInfo,
        owner: srcInfo?.owner?.toBase58(),
        lamports: srcInfo?.lamports,
        dataLen: srcInfo?.data?.length,
        executable: srcInfo?.executable,
      })
    );
    console.log(
      "claimUsernameDepositToDeposit destinationDeposit accountInfo:",
      prettyStringify({
        address: destinationDeposit.toBase58(),
        exists: !!dstInfo,
        owner: dstInfo?.owner?.toBase58(),
        lamports: dstInfo?.lamports,
        dataLen: dstInfo?.data?.length,
        executable: dstInfo?.executable,
      })
    );
    console.log(
      "claimUsernameDepositToDeposit session accountInfo:",
      prettyStringify({
        address: session.toBase58(),
        exists: !!sessionInfo,
        owner: sessionInfo?.owner?.toBase58(),
        lamports: sessionInfo?.lamports,
        dataLen: sessionInfo?.data?.length,
        executable: sessionInfo?.executable,
      })
    );

    try {
      const sim = await this.ephemeralProgram.methods
        .claimUsernameDepositToDeposit(new BN(amount.toString()))
        .accountsPartial(accounts)
        .simulate();
      console.log("claimUsernameDepositToDeposit simulation logs:", sim.raw);
    } catch (simErr: unknown) {
      const simResponse = (
        simErr as {
          simulationResponse?: {
            logs?: string[];
            err?: unknown;
            unitsConsumed?: number;
          };
        }
      ).simulationResponse;
      console.error("claimUsernameDepositToDeposit simulate FAILED");
      console.error(
        "  error message:",
        simErr instanceof Error ? simErr.message : String(simErr)
      );
      if (simResponse) {
        console.error("  simulation err:", prettyStringify(simResponse.err));
        console.error("  simulation logs:", prettyStringify(simResponse.logs));
        console.error("  unitsConsumed:", simResponse.unitsConsumed);
      }
      throw simErr;
    }

    const signature = await this.ephemeralProgram.methods
      .claimUsernameDepositToDeposit(new BN(amount.toString()))
      .accountsPartial(accounts)
      .rpc({ skipPreflight: true, commitment: "confirmed" });

    return signature;
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
    const { user, tokenMint, payer, rpcOptions } = params;

    const [depositPda] = findDepositPda(user, tokenMint);
    const [permissionPda] = findPermissionPda(depositPda);

    await this.ensureNotDelegated(depositPda, "createPermission-depositPda");

    if (await this.permissionAccountExists(permissionPda)) {
      return null;
    }

    try {
      const signature = await this.baseProgram.methods
        .createPermission()
        .accountsPartial({
          payer,
          user,
          deposit: depositPda,
          permission: permissionPda,
          permissionProgram: PERMISSION_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc(rpcOptions);

      return signature;
    } catch (err) {
      if (this.isAccountAlreadyInUse(err)) {
        return "permission-exists";
      }
      throw err;
    }
  }

  /**
   * Create a permission for a username-based deposit account
   */
  async createUsernamePermission(
    params: CreateUsernamePermissionParams
  ): Promise<string | null> {
    const { username, tokenMint, session, authority, payer, rpcOptions } =
      params;

    this.validateUsername(username);

    const [depositPda] = await findUsernameDepositPda(username, tokenMint);
    const [permissionPda] = findPermissionPda(depositPda);

    await this.ensureNotDelegated(
      depositPda,
      "createUsernamePermission-depositPda"
    );

    if (await this.permissionAccountExists(permissionPda)) {
      return null;
    }

    try {
      const signature = await this.baseProgram.methods
        .createUsernamePermission()
        .accountsPartial({
          payer,
          authority,
          deposit: depositPda,
          session,
          permission: permissionPda,
          permissionProgram: PERMISSION_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc(rpcOptions);

      return signature;
    } catch (err) {
      if (this.isAccountAlreadyInUse(err)) {
        return "permission-exists";
      }
      throw err;
    }
  }

  // ============================================================
  // Delegation Operations
  // ============================================================

  /**
   * Delegate a deposit account to the ephemeral rollup
   */
  async delegateDeposit(params: DelegateDepositParams): Promise<string> {
    const { user, tokenMint, payer, validator, rpcOptions } = params;

    const [depositPda] = findDepositPda(user, tokenMint);
    const [bufferPda] = findBufferPda(depositPda);
    const [delegationRecordPda] = findDelegationRecordPda(depositPda);
    const [delegationMetadataPda] = findDelegationMetadataPda(depositPda);

    await this.ensureNotDelegated(depositPda, "delegateDeposit-depositPda");

    const accounts: Record<string, PublicKey | null> = {
      payer,
      bufferDeposit: bufferPda,
      delegationRecordDeposit: delegationRecordPda,
      delegationMetadataDeposit: delegationMetadataPda,
      deposit: depositPda,
      validator,
      ownerProgram: PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };

    const delegationWatcher = waitForAccountOwnerChange(
      this.baseProgram.provider.connection,
      depositPda,
      DELEGATION_PROGRAM_ID
    );

    let signature;
    try {
      console.log("delegateDeposit Accounts:", prettyStringify(accounts));
      signature = await this.baseProgram.methods
        .delegate(user, tokenMint)
        .accountsPartial(accounts)
        .rpc(rpcOptions);
      console.log(
        "delegateDeposit: waiting for depositPda owner to be DELEGATION_PROGRAM_ID on base connection..."
      );
      await delegationWatcher.wait();
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    } catch (e) {
      await delegationWatcher.cancel();
      throw e;
    }

    return signature;
  }

  /**
   * Delegate a username-based deposit account to the ephemeral rollup
   */
  async delegateUsernameDeposit(
    params: DelegateUsernameDepositParams
  ): Promise<string> {
    const {
      username,
      tokenMint,
      // session,
      payer,
      validator,
      rpcOptions,
    } = params;

    this.validateUsername(username);

    const [depositPda] = await findUsernameDepositPda(username, tokenMint);
    const [bufferPda] = findBufferPda(depositPda);
    const [delegationRecordPda] = findDelegationRecordPda(depositPda);
    const [delegationMetadataPda] = findDelegationMetadataPda(depositPda);

    const usernameHash = await sha256hash(username);

    await this.ensureNotDelegated(
      depositPda,
      "delegateUsernameDeposit-depositPda"
    );

    const accounts: Record<string, PublicKey | null> = {
      payer,
      // session,
      bufferDeposit: bufferPda,
      delegationRecordDeposit: delegationRecordPda,
      delegationMetadataDeposit: delegationMetadataPda,
      deposit: depositPda,
      ownerProgram: PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };

    accounts.validator = validator ?? null;

    const delegationWatcher = waitForAccountOwnerChange(
      this.baseProgram.provider.connection,
      depositPda,
      DELEGATION_PROGRAM_ID
    );

    let signature;
    try {
      console.log(
        "delegateUsernameDeposit Accounts:",
        prettyStringify(accounts)
      );
      signature = await this.baseProgram.methods
        .delegateUsernameDeposit(usernameHash, tokenMint)
        .accountsPartial(accounts)
        .rpc(rpcOptions);
      console.log(
        "delegateUsernameDeposit: waiting for depositPda owner to be DELEGATION_PROGRAM_ID on base connection..."
      );
      await delegationWatcher.wait();
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    } catch (e) {
      await delegationWatcher.cancel();
      throw e;
    }

    return signature;
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

    const [depositPda] = await findUsernameDepositPda(username, tokenMint);

    await this.ensureDelegated(
      depositPda,
      "undelegateUsernameDeposit-depositPda"
    );

    const usernameHash = await sha256hash(username);

    const signature = await this.ephemeralProgram.methods
      .undelegateUsernameDeposit(usernameHash, tokenMint)
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
    const [destinationDepositPda] = await findUsernameDepositPda(
      username,
      tokenMint
    );

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
   * Enumerate every Deposit account owned by a user across both the base
   * program and the ephemeral program. Used by the wallet UI to discover
   * shielded holdings even when the user no longer has a matching base-chain
   * token balance.
   *
   * Delegated deposits only exist on the ephemeral chain (on base the PDA is
   * owned by the delegation program and Anchor cannot deserialize it as a
   * `Deposit`). Undelegated deposits only exist on base. We query both and
   * merge by PDA address, preferring the ephemeral amount when both return
   * an entry because ephemeral reflects the live balance.
   */
  async getAllDepositsByUser(user: PublicKey): Promise<DepositData[]> {
    // Deposit layout after the 8-byte discriminator:
    //   user: pubkey (32 bytes) @ offset 8
    //   token_mint: pubkey (32 bytes) @ offset 40
    //   amount: u64 (8 bytes) @ offset 72
    const userFilter = [
      {
        memcmp: {
          offset: 8,
          bytes: user.toBase58(),
        },
      },
    ];

    const [baseResults, ephemeralResults] = await Promise.allSettled([
      this.baseProgram.account.deposit.all(userFilter),
      this.ephemeralProgram.account.deposit.all(userFilter),
    ]);

    const byPda = new Map<string, DepositData>();

    const ingest = (
      results: Array<{
        publicKey: PublicKey;
        account: { user: PublicKey; tokenMint: PublicKey; amount: BN };
      }>,
      preferOverwrite: boolean
    ) => {
      for (const { publicKey, account } of results) {
        const key = publicKey.toBase58();
        if (!preferOverwrite && byPda.has(key)) continue;
        byPda.set(key, {
          user: account.user,
          tokenMint: account.tokenMint,
          amount: BigInt(account.amount.toString()),
          address: publicKey,
        });
      }
    };

    if (baseResults.status === "fulfilled") {
      ingest(baseResults.value, /* preferOverwrite */ false);
    } else {
      console.warn(
        "[getAllDepositsByUser] base program enumeration failed",
        baseResults.reason
      );
    }

    // Ephemeral state wins over base state for live balances.
    if (ephemeralResults.status === "fulfilled") {
      ingest(ephemeralResults.value, /* preferOverwrite */ true);
    } else {
      console.warn(
        "[getAllDepositsByUser] ephemeral program enumeration failed",
        ephemeralResults.reason
      );
    }

    return Array.from(byPda.values());
  }

  /**
   * Get username deposit data
   */
  async getBaseUsernameDeposit(
    username: string,
    tokenMint: PublicKey
  ): Promise<UsernameDepositData | null> {
    const [depositPda] = await findUsernameDepositPda(username, tokenMint);

    try {
      const account = await this.baseProgram.account.usernameDeposit.fetch(
        depositPda
      );
      return {
        usernameHash: account.usernameHash,
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
    const [depositPda] = await findUsernameDepositPda(username, tokenMint);

    try {
      const account = await this.ephemeralProgram.account.usernameDeposit.fetch(
        depositPda
      );
      return {
        usernameHash: account.usernameHash,
        tokenMint: account.tokenMint,
        amount: BigInt(account.amount.toString()),
        address: depositPda,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get the live base lending APY for the configured Kamino reserve in basis points.
   * This is reserve supply APY only and does not include farm reward APY.
   * Returns null when the token mint has no hardcoded Kamino reserve config.
   * Devnet reserves intentionally return 0 because the UI APY source is mainnet-only.
   */
  async getKaminoLendingApyBps(tokenMint: PublicKey): Promise<number | null> {
    const kaminoAccounts = getKaminoModifyBalanceAccountsForTokenMint(tokenMint);
    if (!kaminoAccounts) {
      return null;
    }

    if (!isKaminoMainnetModifyBalanceAccounts(kaminoAccounts)) {
      return 0;
    }

    return fetchKaminoReserveSupplyApyBps({
      lendingMarket: kaminoAccounts.lendingMarket,
      reserve: kaminoAccounts.reserve,
      env: getKaminoApiEnv(kaminoAccounts),
    });
  }

  async getKaminoReserveSnapshot(
    tokenMint: PublicKey
  ): Promise<KaminoReserveSnapshot | null> {
    const kaminoAccounts = getKaminoModifyBalanceAccountsForTokenMint(tokenMint);
    if (!kaminoAccounts) {
      return null;
    }

    return fetchKaminoReserveSnapshot({
      connection: this.baseProgram.provider.connection,
      tokenMint,
    });
  }

  async getKaminoShieldedBalanceQuote(
    params: GetKaminoShieldedBalanceQuoteParams
  ): Promise<KaminoShieldedBalanceQuote | null> {
    const snapshot = await this.getKaminoReserveSnapshot(params.tokenMint);
    if (!snapshot) {
      return null;
    }

    const collateralSharesAmountRaw = normalizeBigInt(
      params.collateralSharesAmountRaw
    );
    const principalLiquidityAmountRaw =
      params.principalLiquidityAmountRaw === undefined ||
      params.principalLiquidityAmountRaw === null
        ? null
        : normalizeBigInt(params.principalLiquidityAmountRaw);
    const shieldCollateralExchangeRateSf =
      params.shieldCollateralExchangeRateSf === undefined ||
      params.shieldCollateralExchangeRateSf === null
        ? null
        : normalizeBigInt(params.shieldCollateralExchangeRateSf);
    const valuation = calculateKaminoCollateralValuation({
      snapshot,
      collateralAmount: collateralSharesAmountRaw,
      principalLiquidityAmount: principalLiquidityAmountRaw,
      shieldCollateralExchangeRateSf,
    });

    return {
      snapshot,
      collateralSharesAmountRaw,
      redeemableLiquidityAmountRaw: valuation.currentLiquidityAmount,
      principalLiquidityAmountRaw: valuation.principalLiquidityAmount,
      earnedLiquidityAmountRaw: valuation.earnedLiquidityAmount,
      shieldCollateralExchangeRateSf,
    };
  }

  async getKaminoCollateralSharesForLiquidityAmount(
    params: GetKaminoCollateralSharesForLiquidityAmountParams
  ): Promise<bigint | null> {
    const snapshot = await this.getKaminoReserveSnapshot(params.tokenMint);
    if (!snapshot) {
      return null;
    }

    return calculateKaminoShareAmountForLiquidityAmountRaw({
      snapshot,
      liquidityAmountRaw: normalizeBigInt(params.liquidityAmountRaw),
      rounding: "ceil",
    });
  }

  calculateKaminoCollateralExchangeRateSfFromAmounts(args: {
    collateralAmountRaw: number | bigint;
    liquidityAmountRaw: number | bigint;
  }): bigint | null {
    return calculateKaminoCollateralExchangeRateSfFromAmounts({
      collateralAmount: normalizeBigInt(args.collateralAmountRaw),
      liquidityAmount: normalizeBigInt(args.liquidityAmountRaw),
    });
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
    if (!/^[a-z0-9_]+$/.test(username)) {
      throw new Error(
        "Username can only contain lowercase alphanumeric characters and underscores"
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
