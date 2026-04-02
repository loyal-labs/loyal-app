import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  type Commitment,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotent,
  createMint,
  getAccount,
  mintToChecked,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  LoyalPrivateTransactionsClient,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PROGRAM_ID,
} from "../index";
import type { TelegramVerification } from "../../../target/types/telegram_verification";

// =============================================================================
// Environment Configuration
// =============================================================================

/**
 * Network type for test configuration
 */
type NetworkType = "localnet" | "devnet";

/**
 * Test environment configuration loaded from environment variables
 */
interface TestConfig {
  network: NetworkType;

  // Base layer (Solana) endpoints
  baseRpcEndpoint: string;
  baseWsEndpoint: string;

  // Ephemeral rollup endpoints
  erRpcEndpoint: string;
  erWsEndpoint: string;

  // Validator configuration
  erValidator: PublicKey;

  // Commitment level
  commitment: Commitment;

  // Retry configuration
  retryAttempts: number;
  retryDelayMs: number;
  transferRetries: number;
  transferRetryDelayMs: number;

  // Commit polling
  commitPollMs: number;
  commitMaxPolls: number;

  // Test amounts (in token base units, assuming 6 decimals)
  initialAmount: number;
  depositAmount: number;
  claimAmount: number;
  transferAmount: number;

  // Airdrop amount for test wallets (in lamports)
  airdropAmount: number;
  minBalance: number;

  // Skip certain tests on devnet
  skipTelegramVerification: boolean;

  // Use existing token mint on devnet
  existingTokenMint: PublicKey | null;
}

/**
 * Load test configuration from environment variables
 */
function loadTestConfig(): TestConfig {
  const network = (process.env.TEST_NETWORK ?? "localnet") as NetworkType;
  const isDevnet = network === "devnet";

  // Derive WebSocket endpoint from RPC endpoint
  const deriveWsEndpoint = (rpcUrl: string): string =>
    rpcUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");

  // Base layer endpoints
  const baseRpcEndpoint =
    process.env.PROVIDER_ENDPOINT ??
    process.env.ANCHOR_PROVIDER_URL ??
    (isDevnet ? "https://api.devnet.solana.com" : "http://127.0.0.1:8899");

  const baseWsEndpoint =
    process.env.WS_ENDPOINT ??
    (baseRpcEndpoint.includes("localhost") || baseRpcEndpoint.includes("127.0.0.1")
      ? "ws://127.0.0.1:8900"
      : deriveWsEndpoint(baseRpcEndpoint));

  // Ephemeral rollup endpoints
  const erRpcEndpoint =
    process.env.EPHEMERAL_PROVIDER_ENDPOINT ??
    (isDevnet
      ? "https://devnet.magicblock.app"
      : "http://127.0.0.1:7799");

  const erWsEndpoint =
    process.env.EPHEMERAL_WS_ENDPOINT ??
    (erRpcEndpoint.includes("localhost") || erRpcEndpoint.includes("127.0.0.1")
      ? "ws://127.0.0.1:7800"
      : deriveWsEndpoint(erRpcEndpoint));

  // Validator identity
  const erValidator = new PublicKey(
    process.env.ER_VALIDATOR ??
    process.env.MAGICBLOCK_VALIDATOR ??
    "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"
  );

  // Commitment level
  const commitment = (process.env.PROVIDER_COMMITMENT ?? "confirmed") as Commitment;

  // Existing token mint for devnet (optional)
  const existingTokenMintStr = process.env.TOKEN_MINT;
  const existingTokenMint = existingTokenMintStr
    ? new PublicKey(existingTokenMintStr)
    : null;

  return {
    network,
    baseRpcEndpoint,
    baseWsEndpoint,
    erRpcEndpoint,
    erWsEndpoint,
    erValidator,
    commitment,

    // Retry configuration
    retryAttempts: Number(process.env.RETRY_ATTEMPTS ?? "5"),
    retryDelayMs: Number(process.env.RETRY_DELAY_MS ?? "500"),
    transferRetries: Number(process.env.TRANSFER_RETRIES ?? "30"),
    transferRetryDelayMs: Number(process.env.TRANSFER_RETRY_DELAY_MS ?? "1000"),

    // Commit polling
    commitPollMs: Number(process.env.COMMIT_POLL_MS ?? "200"),
    commitMaxPolls: Number(process.env.COMMIT_MAX_POLLS ?? "150"),

    // Test amounts
    initialAmount: Number(process.env.INITIAL_AMOUNT ?? "1000000"),
    depositAmount: Number(process.env.DEPOSIT_AMOUNT ?? "200000"),
    claimAmount: Number(process.env.CLAIM_AMOUNT ?? "100000"),
    transferAmount: Number(process.env.TRANSFER_AMOUNT ?? "100000"),

    // Airdrop configuration
    airdropAmount: Number(process.env.AIRDROP_AMOUNT ?? String(LAMPORTS_PER_SOL)),
    minBalance: Number(process.env.MIN_BALANCE ?? String(0.2 * LAMPORTS_PER_SOL)),

    // Skip telegram verification on devnet (requires valid signature)
    skipTelegramVerification: process.env.SKIP_TELEGRAM_VERIFICATION === "true" || isDevnet,

    existingTokenMint,
  };
}

// =============================================================================
// Test Data
// =============================================================================

// Telegram verification test data (valid signature for username "dig133713337")
const VALIDATION_BYTES: Uint8Array = new Uint8Array([
  56, 48, 54, 53, 49, 52, 48, 52, 57, 57, 58, 87, 101, 98, 65, 112, 112, 68,
  97, 116, 97, 10, 97, 117, 116, 104, 95, 100, 97, 116, 101, 61, 49, 55, 54,
  51, 53, 57, 56, 51, 55, 53, 10, 99, 104, 97, 116, 95, 105, 110, 115, 116,
  97, 110, 99, 101, 61, 45, 52, 53, 57, 55, 56, 48, 55, 53, 56, 53, 54, 55,
  51, 56, 52, 53, 53, 55, 49, 10, 99, 104, 97, 116, 95, 116, 121, 112, 101,
  61, 115, 101, 110, 100, 101, 114, 10, 117, 115, 101, 114, 61, 123, 34,
  105, 100, 34, 58, 56, 49, 51, 56, 55, 57, 55, 55, 54, 55, 44, 34, 102,
  105, 114, 115, 116, 95, 110, 97, 109, 101, 34, 58, 34, 84, 114, 97, 118,
  105, 115, 34, 44, 34, 108, 97, 115, 116, 95, 110, 97, 109, 101, 34, 58,
  34, 34, 44, 34, 117, 115, 101, 114, 110, 97, 109, 101, 34, 58, 34, 100,
  105, 103, 49, 51, 51, 55, 49, 51, 51, 51, 55, 34, 44, 34, 108, 97, 110,
  103, 117, 97, 103, 101, 95, 99, 111, 100, 101, 34, 58, 34, 101, 110, 34,
  44, 34, 97, 108, 108, 111, 119, 115, 95, 119, 114, 105, 116, 101, 95, 116,
  111, 95, 112, 109, 34, 58, 116, 114, 117, 101, 44, 34, 112, 104, 111, 116,
  111, 95, 117, 114, 108, 34, 58, 34, 104, 116, 116, 112, 115, 58, 92, 47,
  92, 47, 116, 46, 109, 101, 92, 47, 105, 92, 47, 117, 115, 101, 114, 112,
  105, 99, 92, 47, 51, 50, 48, 92, 47, 120, 99, 90, 85, 85, 85, 87, 51, 117,
  74, 50, 99, 79, 80, 86, 73, 81, 85, 111, 99, 104, 105, 119, 72, 99, 56,
  113, 118, 114, 56, 106, 114, 108, 66, 56, 74, 45, 72, 88, 120, 105, 112,
  98, 83, 74, 76, 122, 122, 118, 120, 73, 99, 79, 106, 55, 103, 55, 70, 49,
  69, 78, 116, 72, 71, 46, 115, 118, 103, 34, 125,
]);

const VALIDATION_SIGNATURE_BYTES: Uint8Array = new Uint8Array([
  139, 171, 57, 233, 145, 1, 218, 227, 29, 106, 55, 30, 237, 207, 28, 229,
  22, 234, 202, 160, 221, 31, 219, 251, 151, 181, 118, 207, 216, 254, 57, 79,
  209, 9, 176, 4, 81, 224, 69, 253, 250, 110, 16, 143, 73, 60, 35, 61, 66,
  177, 139, 178, 153, 248, 2, 121, 161, 49, 224, 103, 190, 108, 234, 4,
]);

const VALIDATION_USERNAME = "dig133713337";
const TELEGRAM_ED25519_PUBKEY = new Uint8Array(
  Buffer.from("e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d", "hex")
);

// =============================================================================
// Utility Functions
// =============================================================================

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown): boolean {
  const message = (error as Error)?.message ?? "";
  return (
    message.includes("Unknown action") ||
    message.includes("AccountClonerError") ||
    message.includes("FailedToGetSubscriptionSlot") ||
    message.includes("Timed out waiting for") ||
    message.includes("Transaction") ||
    message.includes("Blockhash not found") ||
    message.includes("429") ||
    message.includes("rate limit")
  );
}

/**
 * Run an async function with retries
 */
async function withRetries<T>(
  label: string,
  fn: () => Promise<T>,
  attempts: number,
  delayMs: number
): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`  [retry] ${label} attempt ${attempt}/${attempts}`);
      }
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableError(err) || attempt === attempts) {
        throw err;
      }
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

/**
 * Log test step with prefix
 */
function logStep(step: string): void {
  console.log(`[test] ${step}`);
}

/**
 * Log configuration
 */
function logConfig(config: TestConfig): void {
  console.log("\n=== Test Configuration ===");
  console.log(`Network:          ${config.network}`);
  console.log(`Base RPC:         ${config.baseRpcEndpoint}`);
  console.log(`Base WS:          ${config.baseWsEndpoint}`);
  console.log(`ER RPC:           ${config.erRpcEndpoint}`);
  console.log(`ER WS:            ${config.erWsEndpoint}`);
  console.log(`ER Validator:     ${config.erValidator.toBase58()}`);
  console.log(`Commitment:       ${config.commitment}`);
  console.log(`Skip TG verify:   ${config.skipTelegramVerification}`);
  if (config.existingTokenMint) {
    console.log(`Token Mint:       ${config.existingTokenMint.toBase58()}`);
  }
  console.log("===========================\n");
}

// =============================================================================
// Test Suite
// =============================================================================

describe("LoyalPrivateTransactionsClient SDK", () => {
  // Configuration
  const config = loadTestConfig();

  // Test wallets
  const userKp = Keypair.generate();
  const otherUserKp = Keypair.generate();
  const user = userKp.publicKey;
  const otherUser = otherUserKp.publicKey;

  // Connections
  let baseConnection: anchor.web3.Connection;

  // SDK clients
  let baseClientUser: LoyalPrivateTransactionsClient;
  let baseClientOther: LoyalPrivateTransactionsClient;
  let erClientUser: LoyalPrivateTransactionsClient;
  let erClientOther: LoyalPrivateTransactionsClient;

  // Token accounts
  let tokenMint: PublicKey;
  let userTokenAccount: PublicKey;
  let otherUserTokenAccount: PublicKey;

  // Telegram verification
  let verificationProgram: Program<TelegramVerification> | null = null;
  let sessionPda: PublicKey;

  // RPC options
  const rpcOptions = { skipPreflight: true };

  // =============================================================================
  // Setup
  // =============================================================================

  beforeAll(async () => {
    logConfig(config);

    // Create base layer connection
    baseConnection = new anchor.web3.Connection(config.baseRpcEndpoint, {
      wsEndpoint: config.baseWsEndpoint,
      commitment: config.commitment,
    });

    logStep("Creating SDK clients...");

    // Create base layer clients
    baseClientUser = LoyalPrivateTransactionsClient.from(baseConnection, userKp);
    baseClientOther = LoyalPrivateTransactionsClient.from(baseConnection, otherUserKp);

    // Create ephemeral rollup clients
    erClientUser = await LoyalPrivateTransactionsClient.fromEphemeral({
      signer: userKp,
      rpcEndpoint: config.erRpcEndpoint,
      wsEndpoint: config.erWsEndpoint,
      commitment: config.commitment,
    });

    erClientOther = await LoyalPrivateTransactionsClient.fromEphemeral({
      signer: otherUserKp,
      rpcEndpoint: config.erRpcEndpoint,
      wsEndpoint: config.erWsEndpoint,
      commitment: config.commitment,
    });

    console.log(`  User:        ${user.toBase58()}`);
    console.log(`  Other user:  ${otherUser.toBase58()}`);

    // Fund test wallets
    logStep("Funding test wallets...");
    for (const kp of [userKp, otherUserKp]) {
      const balance = await baseConnection.getBalance(kp.publicKey, "confirmed");
      if (balance < config.minBalance) {
        try {
          const sig = await baseConnection.requestAirdrop(
            kp.publicKey,
            config.airdropAmount
          );
          await baseConnection.confirmTransaction(sig, "confirmed");
          console.log(`  Airdropped ${config.airdropAmount / LAMPORTS_PER_SOL} SOL to ${kp.publicKey.toBase58().slice(0, 8)}...`);
        } catch (err) {
          // Airdrop may fail on devnet due to rate limits
          console.warn(`  Airdrop failed for ${kp.publicKey.toBase58().slice(0, 8)}...: ${(err as Error).message}`);
        }
      } else {
        console.log(`  ${kp.publicKey.toBase58().slice(0, 8)}... has sufficient balance`);
      }
    }

    // Create or use existing token mint
    logStep("Setting up token mint...");
    if (config.existingTokenMint) {
      tokenMint = config.existingTokenMint;
      console.log(`  Using existing mint: ${tokenMint.toBase58()}`);
    } else {
      tokenMint = await createMint(
        baseConnection,
        userKp,
        user,
        null,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );
      console.log(`  Created new mint: ${tokenMint.toBase58()}`);
    }

    // Create token accounts
    logStep("Creating token accounts...");
    userTokenAccount = await createAssociatedTokenAccountIdempotent(
      baseConnection,
      userKp,
      tokenMint,
      user,
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log(`  User ATA: ${userTokenAccount.toBase58()}`);

    otherUserTokenAccount = await createAssociatedTokenAccountIdempotent(
      baseConnection,
      userKp,
      tokenMint,
      otherUser,
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log(`  Other user ATA: ${otherUserTokenAccount.toBase58()}`);

    // Mint initial tokens (only if we created the mint)
    if (!config.existingTokenMint) {
      logStep("Minting initial tokens...");
      await mintToChecked(
        baseConnection,
        userKp,
        tokenMint,
        userTokenAccount,
        user,
        config.initialAmount + config.depositAmount, // Extra for depositForUsername
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );
      console.log(`  Minted ${(config.initialAmount + config.depositAmount) / 1e6} tokens to user`);
    }

    // Setup telegram verification program (if not skipping)
    if (!config.skipTelegramVerification) {
      logStep("Setting up Telegram verification program...");
      try {
        const verificationIdl = JSON.parse(
          await Bun.file("../../target/idl/telegram_verification.json").text()
        ) as TelegramVerification;

        const verificationProvider = new anchor.AnchorProvider(
          baseConnection,
          new anchor.Wallet(otherUserKp),
          { commitment: config.commitment, preflightCommitment: config.commitment }
        );

        verificationProgram = new Program<TelegramVerification>(
          verificationIdl,
          verificationProvider
        );

        [sessionPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("tg_session_v2"), otherUser.toBuffer()],
          verificationProgram.programId
        );

        console.log(`  Verification program: ${verificationProgram.programId.toBase58()}`);
        console.log(`  Session PDA: ${sessionPda.toBase58()}`);
      } catch (err) {
        console.warn(`  Could not load verification program: ${(err as Error).message}`);
        console.warn(`  Telegram verification tests will be skipped`);
      }
    }

    console.log("\n=== Setup Complete ===\n");
  });

  // =============================================================================
  // Factory Method Tests
  // =============================================================================

  describe("Factory Methods", () => {
    it("creates client from Connection and Keypair", () => {
      const client = LoyalPrivateTransactionsClient.from(baseConnection, userKp);
      expect(client.publicKey.equals(user)).toBe(true);
      expect(client.getProgramId().equals(PROGRAM_ID)).toBe(true);
    });

    it("creates client from Keypair using fromKeypair", () => {
      const client = LoyalPrivateTransactionsClient.fromKeypair(baseConnection, userKp);
      expect(client.publicKey.equals(user)).toBe(true);
    });

    it("creates ephemeral client using fromEphemeral", async () => {
      const client = await LoyalPrivateTransactionsClient.fromEphemeral({
        signer: userKp,
        rpcEndpoint: config.erRpcEndpoint,
        wsEndpoint: config.erWsEndpoint,
        commitment: config.commitment,
      });
      expect(client.publicKey.equals(user)).toBe(true);
      expect(client.getProgram().provider.connection.rpcEndpoint).toBe(config.erRpcEndpoint);
    });
  });

  // =============================================================================
  // Deposit Operations Tests
  // =============================================================================

  describe("Deposit Operations", () => {
    it("initializes a deposit account", async () => {
      logStep("Initializing deposit account...");

      const sig = await withRetries(
        "initializeDeposit",
        () => baseClientUser.initializeDeposit({
          user,
          tokenMint,
          payer: user,
          rpcOptions,
        }),
        config.retryAttempts,
        config.retryDelayMs
      );

      expect(sig).toBeDefined();
      console.log(`  Signature: ${sig}`);

      // Verify deposit exists
      const deposit = await baseClientUser.getDeposit(user, tokenMint);
      expect(deposit).not.toBeNull();
      expect(deposit?.user.equals(user)).toBe(true);
      expect(deposit?.tokenMint.equals(tokenMint)).toBe(true);
      expect(deposit?.amount).toBe(0);
      console.log(`  Deposit PDA: ${deposit?.address.toBase58()}`);
    });

    it("modifies deposit balance (increase)", async () => {
      logStep("Modifying deposit balance (deposit tokens)...");

      const result = await withRetries(
        "modifyBalance",
        () => baseClientUser.modifyBalance({
          user,
          tokenMint,
          amount: config.initialAmount,
          increase: true,
          payer: user,
          userTokenAccount,
          rpcOptions,
        }),
        config.retryAttempts,
        config.retryDelayMs
      );

      expect(result.signature).toBeDefined();
      expect(result.deposit.amount).toBe(config.initialAmount);
      console.log(`  Deposited: ${config.initialAmount / 1e6} tokens`);
      console.log(`  New balance: ${result.deposit.amount / 1e6} tokens`);
    });

    it("deposits for a username", async () => {
      logStep("Depositing for username...");

      // Mint additional tokens if needed
      if (!config.existingTokenMint) {
        try {
          const accountInfo = await getAccount(baseConnection, userTokenAccount);
          if (Number(accountInfo.amount) < config.depositAmount) {
            await mintToChecked(
              baseConnection,
              userKp,
              tokenMint,
              userTokenAccount,
              user,
              config.depositAmount,
              6,
              undefined,
              undefined,
              TOKEN_PROGRAM_ID
            );
          }
        } catch {
          // Account may not exist yet
        }
      }

      const sig = await withRetries(
        "depositForUsername",
        () => baseClientUser.depositForUsername({
          username: VALIDATION_USERNAME,
          tokenMint,
          amount: config.depositAmount,
          depositor: user,
          payer: user,
          depositorTokenAccount: userTokenAccount,
          rpcOptions,
        }),
        config.retryAttempts,
        config.retryDelayMs
      );

      expect(sig).toBeDefined();
      console.log(`  Signature: ${sig}`);

      // Verify username deposit
      const deposit = await baseClientUser.getUsernameDeposit(VALIDATION_USERNAME, tokenMint);
      expect(deposit).not.toBeNull();
      expect(deposit?.username).toBe(VALIDATION_USERNAME);
      expect(deposit?.amount).toBe(config.depositAmount);
      console.log(`  Username deposit: ${deposit?.amount / 1e6} tokens`);
    });
  });

  // =============================================================================
  // Permission and Delegation Tests
  // =============================================================================

  describe("Permission and Delegation", () => {
    it("creates permission for deposit account", async () => {
      logStep("Creating permission for deposit...");

      const sig = await withRetries(
        "createPermission",
        () => baseClientUser.createPermission({
          user,
          tokenMint,
          payer: user,
          rpcOptions,
        }),
        config.retryAttempts,
        config.retryDelayMs
      );

      expect(sig).toBeDefined();
      console.log(`  Signature: ${sig}`);
    });

    it("delegates deposit to ephemeral rollup", async () => {
      logStep("Delegating deposit to ephemeral rollup...");

      const sig = await withRetries(
        "delegateDeposit",
        () => baseClientUser.delegateDeposit({
          user,
          tokenMint,
          payer: user,
          validator: config.erValidator,
          rpcOptions,
        }),
        config.retryAttempts,
        config.retryDelayMs
      );

      expect(sig).toBeDefined();
      console.log(`  Signature: ${sig}`);
      console.log(`  Validator: ${config.erValidator.toBase58()}`);
    });
  });

  // =============================================================================
  // Telegram Verification Tests (conditional)
  // =============================================================================

  describe("Telegram Verification", () => {
    it.skipIf(config.skipTelegramVerification || !verificationProgram)(
      "stores and verifies telegram session",
      async () => {
        if (!verificationProgram) {
          throw new Error("Verification program not initialized");
        }

        logStep("Storing Telegram session...");

        await withRetries(
          "storeTelegramSession",
          () => verificationProgram!.methods
            .store(Buffer.from(VALIDATION_BYTES))
            .accounts({
              payer: otherUser,
              user: otherUser,
              session: sessionPda,
              systemProgram: SystemProgram.programId,
            })
            .signers([otherUserKp])
            .rpc({ commitment: config.commitment }),
          config.retryAttempts,
          config.retryDelayMs
        );

        logStep("Verifying Telegram session...");

        const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
          publicKey: TELEGRAM_ED25519_PUBKEY,
          message: VALIDATION_BYTES,
          signature: VALIDATION_SIGNATURE_BYTES,
        });

        const verifyIx = await verificationProgram.methods
          .verifyTelegramInitData()
          .accounts({
            session: sessionPda,
            instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
          })
          .instruction();

        const verifyTx = new Transaction().add(ed25519Ix, verifyIx);
        const { blockhash } = await baseConnection.getLatestBlockhash();
        verifyTx.feePayer = otherUser;
        verifyTx.recentBlockhash = blockhash;
        verifyTx.sign(otherUserKp);

        const sig = await withRetries(
          "verifyTelegramSession",
          () => baseConnection.sendRawTransaction(verifyTx.serialize()),
          config.retryAttempts,
          config.retryDelayMs
        );

        await baseConnection.confirmTransaction(sig, "confirmed");
        console.log(`  Verification signature: ${sig}`);
      }
    );

    it.skipIf(config.skipTelegramVerification || !verificationProgram)(
      "claims username deposit with verified session",
      async () => {
        logStep("Claiming username deposit...");

        const balanceBefore = await baseConnection.getTokenAccountBalance(otherUserTokenAccount);

        const sig = await withRetries(
          "claimUsernameDeposit",
          () => baseClientOther.claimUsernameDeposit({
            username: VALIDATION_USERNAME,
            tokenMint,
            amount: config.claimAmount,
            recipient: otherUser,
            recipientTokenAccount: otherUserTokenAccount,
            session: sessionPda,
            rpcOptions,
          }),
          config.retryAttempts,
          config.retryDelayMs
        );

        expect(sig).toBeDefined();

        const balanceAfter = await baseConnection.getTokenAccountBalance(otherUserTokenAccount);
        expect(Number(balanceAfter.value.amount)).toBeGreaterThan(
          Number(balanceBefore.value.amount)
        );

        console.log(`  Claimed: ${config.claimAmount / 1e6} tokens`);
        console.log(`  New balance: ${Number(balanceAfter.value.amount) / 1e6} tokens`);
      }
    );
  });

  // =============================================================================
  // Private Transfer Tests (on Ephemeral Rollup)
  // =============================================================================

  describe("Private Transfers (PER)", () => {
    it.skipIf(config.skipTelegramVerification || !verificationProgram)(
      "creates permission and delegates username deposit",
      async () => {
        logStep("Creating permission for username deposit...");

        await withRetries(
          "createUsernamePermission",
          () => baseClientOther.createUsernamePermission({
            username: VALIDATION_USERNAME,
            tokenMint,
            session: sessionPda,
            authority: otherUser,
            payer: otherUser,
            rpcOptions,
          }),
          config.retryAttempts,
          config.retryDelayMs
        );

        logStep("Delegating username deposit to ephemeral rollup...");

        await withRetries(
          "delegateUsernameDeposit",
          () => baseClientOther.delegateUsernameDeposit({
            username: VALIDATION_USERNAME,
            tokenMint,
            session: sessionPda,
            payer: otherUser,
            validator: config.erValidator,
            rpcOptions,
          }),
          config.retryAttempts,
          config.retryDelayMs
        );
      }
    );

    it.skipIf(config.skipTelegramVerification || !verificationProgram)(
      "executes private transfer on ephemeral rollup",
      async () => {
        logStep("Executing private transfer to username deposit...");

        let transferSig: string | null = null;
        for (let attempt = 1; attempt <= config.transferRetries; attempt++) {
          try {
            if (attempt > 1) {
              console.log(`  [retry] transfer attempt ${attempt}/${config.transferRetries}`);
            }
            transferSig = await erClientUser.transferToUsernameDeposit({
              username: VALIDATION_USERNAME,
              tokenMint,
              amount: config.transferAmount,
              user,
              payer: user,
              sessionToken: null,
              rpcOptions,
            });
            break;
          } catch (err) {
            if (!isRetryableError(err) || attempt === config.transferRetries) {
              throw err;
            }
            await sleep(config.transferRetryDelayMs);
          }
        }

        expect(transferSig).not.toBeNull();
        console.log(`  Transfer signature: ${transferSig}`);

        // Confirm on ER
        if (transferSig) {
          await erClientUser.getProgram().provider.connection.confirmTransaction(transferSig);
        }

        // Verify on ER
        let erDeposit = await erClientOther.getUsernameDeposit(VALIDATION_USERNAME, tokenMint);
        for (let i = 0; i < 25 && !erDeposit; i++) {
          await sleep(200);
          erDeposit = await erClientOther.getUsernameDeposit(VALIDATION_USERNAME, tokenMint);
        }

        const expectedAmount = config.depositAmount - config.claimAmount + config.transferAmount;
        expect(erDeposit?.amount).toBe(expectedAmount);
        console.log(`  ER username deposit balance: ${erDeposit?.amount / 1e6} tokens`);
      }
    );

    it.skipIf(config.skipTelegramVerification || !verificationProgram)(
      "undelegates accounts and commits to base layer",
      async () => {
        logStep("Undelegating username deposit...");

        const undelegateUsernameSig = await withRetries(
          "undelegateUsernameDeposit",
          () => erClientOther.undelegateUsernameDeposit({
            username: VALIDATION_USERNAME,
            tokenMint,
            session: sessionPda,
            payer: otherUser,
            magicProgram: MAGIC_PROGRAM_ID,
            magicContext: MAGIC_CONTEXT_ID,
            rpcOptions,
          }),
          config.retryAttempts,
          config.retryDelayMs
        );

        await erClientOther.getProgram().provider.connection.confirmTransaction(undelegateUsernameSig);
        console.log(`  Username undelegate signature: ${undelegateUsernameSig}`);

        logStep("Undelegating user deposit...");

        const undelegateSig = await withRetries(
          "undelegateDeposit",
          () => erClientUser.undelegateDeposit({
            user,
            tokenMint,
            payer: user,
            magicProgram: MAGIC_PROGRAM_ID,
            magicContext: MAGIC_CONTEXT_ID,
            rpcOptions,
          }),
          config.retryAttempts,
          config.retryDelayMs
        );

        await erClientUser.getProgram().provider.connection.confirmTransaction(undelegateSig);
        console.log(`  User undelegate signature: ${undelegateSig}`);

        logStep("Waiting for base layer commit...");

        const expectedUsernameAmount = config.depositAmount - config.claimAmount + config.transferAmount;
        const expectedUserAmount = config.initialAmount - config.transferAmount;

        // Poll for username deposit commit
        let baseUsernameDeposit = await baseClientUser.getUsernameDeposit(VALIDATION_USERNAME, tokenMint);
        for (let i = 0; i < config.commitMaxPolls; i++) {
          if (baseUsernameDeposit?.amount === expectedUsernameAmount) break;
          await sleep(config.commitPollMs);
          baseUsernameDeposit = await baseClientUser.getUsernameDeposit(VALIDATION_USERNAME, tokenMint);
        }
        expect(baseUsernameDeposit?.amount).toBe(expectedUsernameAmount);
        console.log(`  Base username deposit: ${baseUsernameDeposit?.amount / 1e6} tokens`);

        // Poll for user deposit commit
        let baseUserDeposit = await baseClientUser.getDeposit(user, tokenMint);
        for (let i = 0; i < config.commitMaxPolls; i++) {
          if (baseUserDeposit?.amount === expectedUserAmount) break;
          await sleep(config.commitPollMs);
          baseUserDeposit = await baseClientUser.getDeposit(user, tokenMint);
        }
        expect(baseUserDeposit?.amount).toBe(expectedUserAmount);
        console.log(`  Base user deposit: ${baseUserDeposit?.amount / 1e6} tokens`);
      }
    );
  });

  // =============================================================================
  // Query Method Tests
  // =============================================================================

  describe("Query Methods", () => {
    it("fetches deposit account data", async () => {
      const deposit = await baseClientUser.getDeposit(user, tokenMint);
      expect(deposit).not.toBeNull();
      expect(deposit?.user.equals(user)).toBe(true);
      expect(deposit?.tokenMint.equals(tokenMint)).toBe(true);
    });

    it("fetches username deposit account data", async () => {
      const deposit = await baseClientUser.getUsernameDeposit(VALIDATION_USERNAME, tokenMint);
      expect(deposit).not.toBeNull();
      expect(deposit?.username).toBe(VALIDATION_USERNAME);
      expect(deposit?.tokenMint.equals(tokenMint)).toBe(true);
    });

    it("returns null for non-existent deposit", async () => {
      const randomUser = Keypair.generate().publicKey;
      const deposit = await baseClientUser.getDeposit(randomUser, tokenMint);
      expect(deposit).toBeNull();
    });
  });
});
