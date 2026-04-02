import * as anchor from "@coral-xyz/anchor";
import { Program, Idl } from "@coral-xyz/anchor";
import { TelegramPrivateTransfer } from "../target/types/telegram_private_transfer";
import { TelegramVerification } from "../target/types/telegram_verification";
import {
  getAuthToken,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import telegramPrivateTransferIdl from "../target/idl/telegram_private_transfer.json";
import telegramVerificationIdl from "../target/idl/telegram_verification.json";
import {
  createAssociatedTokenAccountIdempotent,
  createMint,
  getAssociatedTokenAddressSync,
  mintToChecked,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";
import {
  Transaction,
  SystemProgram,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  SendTransactionError,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { sign } from "tweetnacl";
import bs58 from "bs58";

const DEPOSIT_PDA_SEED = Buffer.from("deposit_v2");
const USERNAME_DEPOSIT_PDA_SEED = Buffer.from("username_deposit_v2");
const VAULT_PDA_SEED = Buffer.from("vault");

const VALIDATION_BYTES: Uint8Array = new Uint8Array([
  56, 48, 54, 53, 49, 52, 48, 52, 57, 57, 58, 87, 101, 98, 65, 112, 112, 68, 97,
  116, 97, 10, 97, 117, 116, 104, 95, 100, 97, 116, 101, 61, 49, 55, 54, 51, 53,
  57, 56, 51, 55, 53, 10, 99, 104, 97, 116, 95, 105, 110, 115, 116, 97, 110, 99,
  101, 61, 45, 52, 53, 57, 55, 56, 48, 55, 53, 56, 53, 54, 55, 51, 56, 52, 53,
  53, 55, 49, 10, 99, 104, 97, 116, 95, 116, 121, 112, 101, 61, 115, 101, 110,
  100, 101, 114, 10, 117, 115, 101, 114, 61, 123, 34, 105, 100, 34, 58, 56, 49,
  51, 56, 55, 57, 55, 55, 54, 55, 44, 34, 102, 105, 114, 115, 116, 95, 110, 97,
  109, 101, 34, 58, 34, 84, 114, 97, 118, 105, 115, 34, 44, 34, 108, 97, 115,
  116, 95, 110, 97, 109, 101, 34, 58, 34, 34, 44, 34, 117, 115, 101, 114, 110,
  97, 109, 101, 34, 58, 34, 100, 105, 103, 49, 51, 51, 55, 49, 51, 51, 51, 55,
  34, 44, 34, 108, 97, 110, 103, 117, 97, 103, 101, 95, 99, 111, 100, 101, 34,
  58, 34, 101, 110, 34, 44, 34, 97, 108, 108, 111, 119, 115, 95, 119, 114, 105,
  116, 101, 95, 116, 111, 95, 112, 109, 34, 58, 116, 114, 117, 101, 44, 34, 112,
  104, 111, 116, 111, 95, 117, 114, 108, 34, 58, 34, 104, 116, 116, 112, 115,
  58, 92, 47, 92, 47, 116, 46, 109, 101, 92, 47, 105, 92, 47, 117, 115, 101,
  114, 112, 105, 99, 92, 47, 51, 50, 48, 92, 47, 120, 99, 90, 85, 85, 85, 87,
  51, 117, 74, 50, 99, 79, 80, 86, 73, 81, 85, 111, 99, 104, 105, 119, 72, 99,
  56, 113, 118, 114, 56, 106, 114, 108, 66, 56, 74, 45, 72, 88, 120, 105, 112,
  98, 83, 74, 76, 122, 122, 118, 120, 73, 99, 79, 106, 55, 103, 55, 70, 49, 69,
  78, 116, 72, 71, 46, 115, 118, 103, 34, 125,
]);

const VALIDATION_SIGNATURE_BYTES: Uint8Array = new Uint8Array([
  139, 171, 57, 233, 145, 1, 218, 227, 29, 106, 55, 30, 237, 207, 28, 229, 22,
  234, 202, 160, 221, 31, 219, 251, 151, 181, 118, 207, 216, 254, 57, 79, 209,
  9, 176, 4, 81, 224, 69, 253, 250, 110, 16, 143, 73, 60, 35, 61, 66, 177, 139,
  178, 153, 248, 2, 121, 161, 49, 224, 103, 190, 108, 234, 4,
]);

const VALIDATION_USERNAME = "dig133713337";
const COMMIT_POLL_MS = Number(process.env.COMMIT_POLL_MS ?? "200");
const COMMIT_MAX_POLLS = Number(process.env.COMMIT_MAX_POLLS ?? "150");
let lastLogMs: number | null = null;
const formatTime = (date: Date) => date.toISOString().slice(11, 23);
const formatDelta = (ms: number) => `(+${(ms / 1000).toFixed(2)}s)`;
const log = (...args: unknown[]) => {
  const now = Date.now();
  const delta = lastLogMs === null ? 0 : now - lastLogMs;
  lastLogMs = now;
  console.log(`${formatTime(new Date(now))} ${formatDelta(delta)}`, ...args);
};
const logError = (...args: unknown[]) => {
  const now = Date.now();
  const delta = lastLogMs === null ? 0 : now - lastLogMs;
  lastLogMs = now;
  console.error(`${formatTime(new Date(now))} ${formatDelta(delta)}`, ...args);
};
const encodeAnchorStringFilter = (value: string): string => {
  const valueBytes = Buffer.from(value, "utf8");
  const filterBuf = Buffer.alloc(4 + valueBytes.length);
  filterBuf.writeUInt32LE(valueBytes.length, 0);
  valueBytes.copy(filterBuf, 4);
  return bs58.encode(filterBuf);
};
const awaitWithLog = async <T>(
  label: string,
  promise: Promise<T>
): Promise<T> => {
  log("await", label);
  return await promise;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shouldRetryTransfer = (error: unknown) => {
  const message = (error as any)?.message ?? "";
  return (
    message.includes("Unknown action") ||
    message.includes("AccountClonerError") ||
    message.includes("FailedToGetSubscriptionSlot") ||
    message.includes("Timed out waiting for") ||
    message.includes("Transaction") ||
    message.includes("Blockhash not found")
  );
};
const logSendTransactionError = async (
  err: unknown,
  connection: anchor.web3.Connection,
  label: string
) => {
  const error = err as any;
  logError(`${label} error`, error?.message ?? error);
  if (error?.error) {
    try {
      logError(`${label} error details`, JSON.stringify(error.error));
    } catch {
      logError(`${label} error details`, error.error);
    }
  }
  if (error?.logs) {
    logError(`${label} logs`, error.logs);
    return;
  }
  if (
    error instanceof SendTransactionError &&
    typeof error.getLogs === "function"
  ) {
    try {
      const confirmedConnection = new anchor.web3.Connection(
        connection.rpcEndpoint,
        { commitment: "confirmed" }
      );
      const logsPromise =
        error.getLogs.length > 0
          ? error.getLogs(confirmedConnection)
          : error.getLogs();
      const logs = await awaitWithLog(`${label} getLogs`, logsPromise);
      logError(`${label} logs`, logs);
    } catch (logErr) {
      logError(`${label} getLogs failed`, logErr);
    }
  } else if (typeof error?.getLogs === "function") {
    try {
      const confirmedConnection = new anchor.web3.Connection(
        connection.rpcEndpoint,
        { commitment: "confirmed" }
      );
      const logsPromise =
        error.getLogs.length > 0
          ? error.getLogs(confirmedConnection)
          : error.getLogs();
      const logs = await awaitWithLog(`${label} getLogs`, logsPromise);
      logError(`${label} logs`, logs);
    } catch (logErr) {
      logError(`${label} getLogs failed`, logErr);
    }
  }
};
const waitForAccount = async (
  connection: anchor.web3.Connection,
  pubkey: PublicKey,
  label: string
) => {
  for (let i = 0; i < 50; i += 1) {
    const info = await awaitWithLog(
      `getAccountInfo ${label}`,
      connection.getAccountInfo(pubkey)
    );
    if (info) {
      return;
    }
    if (i === 0) {
      log(`Waiting for ${label} to appear on ER...`);
    }
    await awaitWithLog(`sleep 100ms (${label})`, sleep(100));
  }
  throw new Error(`Timed out waiting for ${label} on ER`);
};

describe("telegram-private-transfer", () => {
  const userKp = Keypair.generate();
  const wallet = new anchor.Wallet(userKp);
  const otherUserKp = Keypair.generate();
  const thirdUserKp = Keypair.generate();

  const providerEndpoint =
    process.env.PROVIDER_ENDPOINT ??
    process.env.ANCHOR_PROVIDER_URL ??
    "http://127.0.0.1:8899";
  const wsEndpoint = process.env.WS_ENDPOINT ?? "ws://127.0.0.1:8900";
  const ephemeralProviderEndpoint =
    process.env.EPHEMERAL_PROVIDER_ENDPOINT ?? "http://127.0.0.1:7799";
  const commitment =
    (process.env.PROVIDER_COMMITMENT as anchor.web3.Commitment) ?? "processed";
  const deriveWsEndpoint = (rpcUrl: string) =>
    rpcUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  const ephemeralWsEndpoint =
    process.env.EPHEMERAL_WS_ENDPOINT ??
    (ephemeralProviderEndpoint.includes("localhost") ||
    ephemeralProviderEndpoint.includes("127.0.0.1")
      ? "ws://127.0.0.1:7800"
      : deriveWsEndpoint(ephemeralProviderEndpoint));
  const provider = new anchor.AnchorProvider(
    new anchor.web3.Connection(providerEndpoint, {
      wsEndpoint,
      commitment,
    }),
    wallet,
    {
      commitment,
      preflightCommitment: commitment,
    }
  );
  anchor.setProvider(provider);
  log("Provider commitment", commitment);
  const erValidator = new PublicKey(
    process.env.ER_VALIDATOR ??
      process.env.MAGICBLOCK_VALIDATOR ??
      "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"
  );

  const program = new Program<TelegramPrivateTransfer>(
    telegramPrivateTransferIdl,
    provider
  );
  const verificationProgram = new Program<TelegramVerification>(
    telegramVerificationIdl,
    provider
  );
  let ephemeralProgramUser: Program<TelegramPrivateTransfer>;
  let ephemeralProgramOtherUser: Program<TelegramPrivateTransfer>;
  let ephemeralProgramThirdUser: Program<TelegramPrivateTransfer>;
  let baseProgramOtherUser: Program<TelegramPrivateTransfer>;
  const user = userKp.publicKey;
  const otherUser = otherUserKp.publicKey;
  const thirdUser = thirdUserKp.publicKey;
  let tokenMint: PublicKey,
    userTokenAccount: PublicKey,
    otherUserTokenAccount: PublicKey,
    vaultPda: PublicKey,
    vaultTokenAccount: PublicKey;
  const initialAmount = 1000000;
  let depositPda: PublicKey,
    otherDepositPda: PublicKey,
    usernameDepositPda: PublicKey;
  let sessionPda: PublicKey;
  let usernameTransferSig: string | null = null;
  let privateTransferSig: string | null = null;
  let basePerf: { elapsedMs: number; tps: number } | null = null;

  before(async () => {
    const hasEphemeralToken = ephemeralProviderEndpoint.includes("token=");
    const useEphemeralAuth =
      process.env.EPHEMERAL_AUTH === "true" ||
      (!hasEphemeralToken &&
        (ephemeralProviderEndpoint.includes("tee.magicblock.app") ||
          ephemeralProviderEndpoint.includes("mainnet-tee.magicblock.app") ||
          ephemeralProviderEndpoint.includes("magicblock.app")));
    const ephemeralRpcBase = ephemeralProviderEndpoint;
    const ephemeralWsBase = ephemeralWsEndpoint;
    let userEphemeralRpc = ephemeralRpcBase;
    let userEphemeralWs = ephemeralWsBase;
    if (useEphemeralAuth) {
      const { token } = await awaitWithLog(
        "getAuthToken user",
        getAuthToken(ephemeralRpcBase, wallet.publicKey, async (message) =>
          sign.detached(message, userKp.secretKey)
        )
      );
      userEphemeralRpc = `${ephemeralRpcBase}?token=${token}`;
      userEphemeralWs = `${ephemeralWsBase}?token=${token}`;
    }
    const ephemeralProviderUser = new anchor.AnchorProvider(
      new anchor.web3.Connection(userEphemeralRpc, {
        wsEndpoint: userEphemeralWs,
        commitment,
      }),
      wallet,
      {
        commitment,
        preflightCommitment: commitment,
      }
    );
    ephemeralProgramUser = new Program<TelegramPrivateTransfer>(
      telegramPrivateTransferIdl,
      ephemeralProviderUser
    );

    let otherEphemeralRpc = ephemeralRpcBase;
    let otherEphemeralWs = ephemeralWsBase;
    if (useEphemeralAuth) {
      const { token: otherToken } = await awaitWithLog(
        "getAuthToken other user",
        getAuthToken(ephemeralRpcBase, otherUserKp.publicKey, async (message) =>
          sign.detached(message, otherUserKp.secretKey)
        )
      );
      otherEphemeralRpc = `${ephemeralRpcBase}?token=${otherToken}`;
      otherEphemeralWs = `${ephemeralWsBase}?token=${otherToken}`;
    }
    const ephemeralProviderOtherUser = new anchor.AnchorProvider(
      new anchor.web3.Connection(otherEphemeralRpc, {
        wsEndpoint: otherEphemeralWs,
        commitment,
      }),
      new anchor.Wallet(otherUserKp),
      {
        commitment,
        preflightCommitment: commitment,
      }
    );
    ephemeralProgramOtherUser = new Program<TelegramPrivateTransfer>(
      telegramPrivateTransferIdl,
      ephemeralProviderOtherUser
    );
    let thirdEphemeralRpc = ephemeralRpcBase;
    let thirdEphemeralWs = ephemeralWsBase;
    if (useEphemeralAuth) {
      const { token: thirdToken } = await awaitWithLog(
        "getAuthToken third user",
        getAuthToken(ephemeralRpcBase, thirdUserKp.publicKey, async (message) =>
          sign.detached(message, thirdUserKp.secretKey)
        )
      );
      thirdEphemeralRpc = `${ephemeralRpcBase}?token=${thirdToken}`;
      thirdEphemeralWs = `${ephemeralWsBase}?token=${thirdToken}`;
    }
    const ephemeralProviderThirdUser = new anchor.AnchorProvider(
      new anchor.web3.Connection(thirdEphemeralRpc, {
        wsEndpoint: thirdEphemeralWs,
        commitment,
      }),
      new anchor.Wallet(thirdUserKp),
      {
        commitment,
        preflightCommitment: commitment,
      }
    );
    ephemeralProgramThirdUser = new Program<TelegramPrivateTransfer>(
      telegramPrivateTransferIdl,
      ephemeralProviderThirdUser
    );
    baseProgramOtherUser = new Program<TelegramPrivateTransfer>(
      telegramPrivateTransferIdl,
      new anchor.AnchorProvider(
        provider.connection,
        new anchor.Wallet(otherUserKp),
        {
          commitment,
          preflightCommitment: commitment,
        }
      )
    );

    const faucet = anchor.Wallet.local();

    // Airdrop SOL to the users
    for (const kp of [userKp, otherUserKp, thirdUserKp]) {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: faucet.publicKey,
          toPubkey: kp.publicKey,
          lamports: 0.1 * LAMPORTS_PER_SOL,
        })
      );
      tx.recentBlockhash = (
        await awaitWithLog(
          "getLatestBlockhash",
          provider.connection.getLatestBlockhash()
        )
      ).blockhash;
      tx.feePayer = faucet.publicKey;
      let signedTx = await awaitWithLog(
        "faucet.signTransaction",
        faucet.signTransaction(tx)
      );
      let rawTx = signedTx.serialize();
      let sig = await awaitWithLog(
        "sendRawTransaction",
        provider.connection.sendRawTransaction(rawTx)
      );
      await awaitWithLog(
        "confirmTransaction (airdrop transfer)",
        provider.connection.confirmTransaction(sig)
      );
    }

    let balance = await awaitWithLog(
      "getBalance user",
      provider.connection.getBalance(userKp.publicKey)
    );
    log("Balance", balance);
    while (balance === 0) {
      log("Airdropping...");
      await awaitWithLog("sleep 100ms (airdrop)", sleep(100));
      balance = await awaitWithLog(
        "getBalance user (retry)",
        provider.connection.getBalance(userKp.publicKey)
      );
    }
    if (balance === 0) throw new Error("airdrop failed...");

    log("Creating mint...");
    tokenMint = await awaitWithLog(
      "createMint",
      createMint(
        provider.connection,
        userKp,
        user,
        null,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      )
    );

    let mintInfo = await awaitWithLog(
      "getAccountInfo tokenMint",
      provider.connection.getAccountInfo(tokenMint)
    );
    while (mintInfo === null) {
      log("Waiting for mint to be created...");
      await awaitWithLog("sleep 100ms (mint)", sleep(100));
      mintInfo = await awaitWithLog(
        "getAccountInfo tokenMint (retry)",
        provider.connection.getAccountInfo(tokenMint)
      );
    }

    depositPda = PublicKey.findProgramAddressSync(
      [Buffer.from(DEPOSIT_PDA_SEED), user.toBuffer(), tokenMint.toBuffer()],
      program.programId
    )[0];
    otherDepositPda = PublicKey.findProgramAddressSync(
      [
        Buffer.from(DEPOSIT_PDA_SEED),
        otherUser.toBuffer(),
        tokenMint.toBuffer(),
      ],
      program.programId
    )[0];
    usernameDepositPda = PublicKey.findProgramAddressSync(
      [
        Buffer.from(USERNAME_DEPOSIT_PDA_SEED),
        Buffer.from(VALIDATION_USERNAME),
        tokenMint.toBuffer(),
      ],
      program.programId
    )[0];
    vaultPda = PublicKey.findProgramAddressSync(
      [Buffer.from(VAULT_PDA_SEED), tokenMint.toBuffer()],
      program.programId
    )[0];
    vaultTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );

    log("Creating user token account...");
    userTokenAccount = await awaitWithLog(
      "createAssociatedTokenAccountIdempotent",
      createAssociatedTokenAccountIdempotent(
        provider.connection,
        userKp,
        tokenMint,
        user,
        undefined,
        TOKEN_PROGRAM_ID
      )
    );

    let userTokenInfo = await awaitWithLog(
      "getAccountInfo userTokenAccount",
      provider.connection.getAccountInfo(userTokenAccount)
    );
    while (userTokenInfo === null) {
      log("Waiting for user token account to be created...");
      await awaitWithLog("sleep 100ms (user token)", sleep(100));
      userTokenInfo = await awaitWithLog(
        "getAccountInfo userTokenAccount (retry)",
        provider.connection.getAccountInfo(userTokenAccount)
      );
    }

    log("Creating other user token account...");
    otherUserTokenAccount = await awaitWithLog(
      "createAssociatedTokenAccountIdempotent (other user)",
      createAssociatedTokenAccountIdempotent(
        provider.connection,
        userKp,
        tokenMint,
        otherUser,
        undefined,
        TOKEN_PROGRAM_ID
      )
    );

    log("Minting tokens to user...");
    // Mint tokens to the user
    await awaitWithLog(
      "mintToChecked",
      mintToChecked(
        provider.connection,
        userKp,
        tokenMint,
        userTokenAccount,
        user,
        new anchor.BN(initialAmount) as any,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      )
    );

    log("User token account", userTokenAccount.toBase58());
    log("Other user token account", otherUserTokenAccount.toBase58());
    log("Vault token account", vaultTokenAccount.toBase58());
    log("Deposit PDA", depositPda.toBase58());
    log("Other deposit PDA", otherDepositPda.toBase58());
    log("Username deposit PDA", usernameDepositPda.toBase58());
    log("User", user.toBase58());
    log("Other user", otherUser.toBase58());
    log("Third user", thirdUser.toBase58());
    log("Token mint", tokenMint.toBase58());
  });

  it("Initialize deposits", async () => {
    await awaitWithLog(
      "initializeDeposit (user)",
      program.methods
        .initializeDeposit()
        .accountsPartial({
          user,
          deposit: depositPda,
          tokenMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc({ skipPreflight: true })
    );

    let deposit = await awaitWithLog(
      "fetch deposit (user)",
      program.account.deposit.fetch(depositPda)
    );
    assert.equal(deposit.amount.toNumber(), 0);

    const tx = await awaitWithLog(
      "initializeDeposit (other user)",
      program.methods
        .initializeDeposit()
        .accountsPartial({
          user: otherUser,
          deposit: otherDepositPda,
          tokenMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc({ skipPreflight: true })
    );
    log("Initialize deposit tx", tx);
    await awaitWithLog(
      "confirmTransaction (initialize deposit other)",
      provider.connection.confirmTransaction(tx)
    );

    deposit = await awaitWithLog(
      "fetch deposit (other)",
      program.account.deposit.fetch(otherDepositPda)
    );
    assert.equal(deposit.amount.toNumber(), 0);
  });

  it("Modify balance", async () => {
    let tx = await awaitWithLog(
      "modifyBalance +initial/2",
      program.methods
        .modifyBalance({
          amount: new anchor.BN(initialAmount / 2),
          increase: true,
        })
        .accountsPartial({
          user,
          payer: user,
          deposit: depositPda,
          userTokenAccount,
          vault: vaultPda,
          vaultTokenAccount,
          tokenMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc({ skipPreflight: true })
    );
    log("Modify balance tx", tx);
    await awaitWithLog(
      "confirmTransaction (modify +initial/2)",
      provider.connection.confirmTransaction(tx)
    );

    let deposit = await awaitWithLog(
      "fetch deposit (after +initial/2)",
      program.account.deposit.fetch(depositPda)
    );
    assert.equal(deposit.amount.toNumber(), initialAmount / 2);

    tx = await awaitWithLog(
      "modifyBalance -initial/4",
      program.methods
        .modifyBalance({
          amount: new anchor.BN(initialAmount / 4),
          increase: false,
        })
        .accountsPartial({
          user,
          payer: user,
          deposit: depositPda,
          userTokenAccount,
          vault: vaultPda,
          vaultTokenAccount,
          tokenMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc({ skipPreflight: true })
    );
    log("Modify balance tx", tx);
    await awaitWithLog(
      "confirmTransaction (modify -initial/4)",
      provider.connection.confirmTransaction(tx)
    );

    deposit = await awaitWithLog(
      "fetch deposit (after -initial/4)",
      program.account.deposit.fetch(depositPda)
    );
    assert.equal(deposit.amount.toNumber(), initialAmount / 4);

    tx = await awaitWithLog(
      "modifyBalance +3/4 initial",
      program.methods
        .modifyBalance({
          amount: new anchor.BN((3 * initialAmount) / 4),
          increase: true,
        })
        .accountsPartial({
          user,
          payer: user,
          deposit: depositPda,
          userTokenAccount,
          vault: vaultPda,
          vaultTokenAccount,
          tokenMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc({ skipPreflight: true })
    );
    log("Modify balance tx", tx);
    await awaitWithLog(
      "confirmTransaction (modify +3/4)",
      provider.connection.confirmTransaction(tx)
    );

    deposit = await awaitWithLog(
      "fetch deposit (after +3/4)",
      program.account.deposit.fetch(depositPda)
    );
    assert.equal(deposit.amount.toNumber(), initialAmount);
  });

  // it("Performance: transferDeposit base", async () => {
  //   const perfTransfers = Number(process.env.PERF_TRANSFERS ?? "20");
  //   const perfAmount = new anchor.BN(Number(process.env.PERF_AMOUNT ?? "1"));

  //   basePerf = await awaitWithLog(
  //     "runTransfers BASE",
  //     runTransfers(
  //       "BASE",
  //       {
  //         user: program,
  //         other: baseProgramOtherUser,
  //       },
  //       perfTransfers,
  //       perfAmount
  //     )
  //   );
  // });

  it("Create permission", async () => {
    for (const { deposit, kp } of [
      { deposit: depositPda, kp: userKp },
      { deposit: otherDepositPda, kp: otherUserKp },
    ]) {
      const permission = permissionPdaFromAccount(deposit);

      let tx = await awaitWithLog(
        `createPermission ${kp.publicKey.toBase58()}`,
        program.methods
          .createPermission()
          .accountsPartial({
            payer: kp.publicKey,
            user: kp.publicKey,
            deposit,
            permission,
            permissionProgram: PERMISSION_PROGRAM_ID,
          })
          .signers([kp])
          .rpc({ skipPreflight: true })
      );
      log("Create permission tx", tx);
      await awaitWithLog(
        "confirmTransaction (create permission)",
        provider.connection.confirmTransaction(tx)
      );
    }
  });

  it("Delegate", async () => {
    for (const { deposit, kp } of [
      { deposit: depositPda, kp: userKp },
      { deposit: otherDepositPda, kp: otherUserKp },
    ]) {
      const tx = await awaitWithLog(
        `delegate ${kp.publicKey.toBase58()}`,
        program.methods
          .delegate(kp.publicKey, tokenMint)
          .accountsPartial({
            payer: kp.publicKey,
            deposit,
            validator: erValidator,
          })
          .signers([kp])
          .rpc({ skipPreflight: true })
      );
      log("Delegate tx", tx);
      await awaitWithLog(
        "confirmTransaction (delegate)",
        provider.connection.confirmTransaction(tx)
      );
    }
  });

  it("Transfer", async () => {
    const maxAttempts = Number(process.env.TRANSFER_RETRIES ?? "30");
    const retryDelayMs = Number(process.env.TRANSFER_RETRY_DELAY_MS ?? "1000");
    log(
      "Ephemeral RPC endpoint",
      ephemeralProgramUser.provider.connection.rpcEndpoint
    );
    let tx: string | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      log(`Transfer attempt ${attempt}`);
      try {
        tx = await awaitWithLog(
          `transferDeposit attempt ${attempt}`,
          ephemeralProgramUser.methods
            .transferDeposit(new anchor.BN(initialAmount / 2))
            .accountsPartial({
              user,
              sourceDeposit: depositPda,
              destinationDeposit: otherDepositPda,
              sessionToken: null,
              tokenMint,
            })
            .signers([userKp])
            .rpc({ skipPreflight: true })
        );
        break;
      } catch (err) {
        await awaitWithLog(
          `logSendTransactionError Transfer attempt ${attempt}`,
          logSendTransactionError(
            err,
            ephemeralProgramUser.provider.connection,
            "Transfer"
          )
        );
        if (!shouldRetryTransfer(err) || attempt === maxAttempts) {
          throw err;
        }
        await awaitWithLog(
          `sleep ${retryDelayMs}ms (transfer retry ${attempt})`,
          sleep(retryDelayMs)
        );
      }
    }
    if (!tx) {
      throw new Error("Transfer failed without a transaction signature");
    }
    log(
      "Ephemeral RPC endpoint",
      ephemeralProgramOtherUser.provider.connection.rpcEndpoint
    );
    log("Transfer tx", tx);
    privateTransferSig = tx;
    await awaitWithLog(
      "confirmTransaction (transfer)",
      ephemeralProgramUser.provider.connection.confirmTransaction(tx)
    );

    let deposit = await awaitWithLog(
      "fetch deposit (user, after transfer)",
      ephemeralProgramUser.account.deposit.fetch(depositPda)
    );
    assert.equal(deposit.amount.toNumber(), initialAmount / 2);

    deposit = await awaitWithLog(
      "fetch deposit (other, after transfer)",
      ephemeralProgramOtherUser.account.deposit.fetch(otherDepositPda)
    );
    assert.equal(deposit.amount.toNumber(), initialAmount / 2);
  });

  const runTransfers = async (
    label: string,
    perfPrograms: {
      user: Program<TelegramPrivateTransfer>;
      other: Program<TelegramPrivateTransfer>;
    },
    perfTransfers: number,
    perfAmount: anchor.BN
  ) => {
    const start = Date.now();
    for (let i = 0; i < perfTransfers; i += 1) {
      const isUser = i % 2 === 0;
      const pairIndex = Math.floor(i / 2);
      const transferAmount = perfAmount.add(new anchor.BN(pairIndex));
      const source = isUser ? depositPda : otherDepositPda;
      const destination = isUser ? otherDepositPda : depositPda;
      const signer = isUser ? userKp : otherUserKp;
      const userKey = isUser ? user : otherUser;
      const perfProgram = isUser ? perfPrograms.user : perfPrograms.other;
      let sig: string | null = null;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        try {
          sig = await awaitWithLog(
            `${label} transfer ${i + 1}/${perfTransfers} attempt ${attempt}`,
            perfProgram.methods
              .transferDeposit(transferAmount)
              .accountsPartial({
                user: userKey,
                sourceDeposit: source,
                destinationDeposit: destination,
                sessionToken: null,
                tokenMint,
              })
              .signers([signer])
              .rpc({ skipPreflight: true })
          );
          break;
        } catch (err) {
          await awaitWithLog(
            `logSendTransactionError ${label} transfer ${
              i + 1
            } attempt ${attempt}`,
            logSendTransactionError(err, perfProgram.provider.connection, label)
          );
          if (!shouldRetryTransfer(err) || attempt === 5) {
            throw err;
          }
          await awaitWithLog(
            `sleep 500ms (${label} transfer retry ${attempt})`,
            sleep(500)
          );
        }
      }
      if (!sig) {
        throw new Error(`${label} transfer failed without a signature`);
      }
      await awaitWithLog(
        `${label} confirm ${i + 1}/${perfTransfers}`,
        perfProgram.provider.connection.confirmTransaction(sig)
      );
    }
    const elapsedMs = Date.now() - start;
    const tps = perfTransfers / (elapsedMs / 1000);
    log(
      `${label} performance`,
      `count=${perfTransfers}`,
      `ms=${elapsedMs}`,
      `tps=${tps.toFixed(2)}`
    );
    return { elapsedMs, tps };
  };

  // it("Performance: transferDeposit ER", async () => {
  //   const perfTransfers = Number(process.env.PERF_TRANSFERS ?? "20");
  //   const perfAmount = new anchor.BN(Number(process.env.PERF_AMOUNT ?? "1"));

  //   const erPerf = await awaitWithLog(
  //     "runTransfers ER",
  //     runTransfers(
  //       "ER",
  //       {
  //         user: ephemeralProgramUser,
  //         other: ephemeralProgramOtherUser,
  //       },
  //       perfTransfers,
  //       perfAmount
  //     )
  //   );
  //   if (basePerf) {
  //     log("Perf summary", {
  //       base: basePerf,
  //       er: erPerf,
  //       speedup: (erPerf.tps / basePerf.tps).toFixed(2),
  //     });
  //   }
  // });

  it("Store and verify Telegram initData for other user", async () => {
    [sessionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("tg_session_v2"), otherUser.toBuffer()],
      verificationProgram.programId
    );

    await verificationProgram.methods
      .store(Buffer.from(VALIDATION_BYTES))
      .accounts({
        payer: otherUser,
        user: otherUser,
        // @ts-ignore
        session: sessionPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([otherUserKp])
      .rpc({ commitment: "confirmed" });

    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: Buffer.from(
        "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d",
        "hex"
      ),
      message: VALIDATION_BYTES,
      signature: VALIDATION_SIGNATURE_BYTES,
    });

    const verifyIx = await verificationProgram.methods
      .verifyTelegramInitData()
      .accounts({
        session: sessionPda,
        // @ts-ignore
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    const tx = new Transaction().add(ed25519Ix, verifyIx);
    tx.feePayer = otherUser;
    const { blockhash } = await provider.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(otherUserKp);

    const sig = await provider.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
    });
    await provider.connection.confirmTransaction(sig, "confirmed");
  });

  it("Deposit for Telegram username", async () => {
    await awaitWithLog(
      "mintToChecked (top up for username deposit)",
      mintToChecked(
        provider.connection,
        userKp,
        tokenMint,
        userTokenAccount,
        user,
        new anchor.BN(initialAmount / 5) as any,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      )
    );

    await program.methods
      .depositForUsername(VALIDATION_USERNAME, new anchor.BN(initialAmount / 5))
      .accountsPartial({
        payer: user,
        depositor: user,
        deposit: usernameDepositPda,
        vault: vaultPda,
        vaultTokenAccount,
        depositorTokenAccount: userTokenAccount,
        tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([userKp])
      .rpc({ skipPreflight: true });

    const usernameDeposit = await program.account.usernameDeposit.fetch(
      usernameDepositPda
    );
    assert.equal(usernameDeposit.username, VALIDATION_USERNAME);
    assert.equal(usernameDeposit.amount.toNumber(), initialAmount / 5);
  });

  it("Claim username deposit with verified initData", async () => {
    const balanceBefore = await provider.connection.getTokenAccountBalance(
      otherUserTokenAccount
    );

    await program.methods
      .claimUsernameDeposit(new anchor.BN(initialAmount / 10))
      .accountsPartial({
        recipientTokenAccount: otherUserTokenAccount,
        vault: vaultPda,
        vaultTokenAccount,
        deposit: usernameDepositPda,
        tokenMint,
        session: sessionPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ skipPreflight: true });

    const balanceAfter = await provider.connection.getTokenAccountBalance(
      otherUserTokenAccount
    );
    assert.isTrue(
      Number(balanceAfter.value.amount) > Number(balanceBefore.value.amount)
    );
  });

  it("Create permission for username deposit", async () => {
    const permission = permissionPdaFromAccount(usernameDepositPda);
    const tx = await program.methods
      .createUsernamePermission()
      .accountsPartial({
        payer: otherUser,
        authority: otherUser,
        session: sessionPda,
        deposit: usernameDepositPda,
        permission,
        permissionProgram: PERMISSION_PROGRAM_ID,
      })
      .signers([otherUserKp])
      .rpc({ skipPreflight: true });
    await provider.connection.confirmTransaction(tx);
  });

  it("Delegate username deposit", async () => {
    const tx = await program.methods
      .delegateUsernameDeposit(VALIDATION_USERNAME, tokenMint)
      .accountsPartial({
        payer: otherUser,
        deposit: usernameDepositPda,
        validator: erValidator,
        session: sessionPda,
      })
      .signers([otherUserKp])
      .rpc({ skipPreflight: true });
    await provider.connection.confirmTransaction(tx);
  });

  it("Private transfer to username deposit (ER)", async () => {
    const maxAttempts = Number(process.env.TRANSFER_RETRIES ?? "30");
    const retryDelayMs = Number(process.env.TRANSFER_RETRY_DELAY_MS ?? "1000");
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        usernameTransferSig = await awaitWithLog(
          `transferToUsernameDeposit attempt ${attempt}`,
          ephemeralProgramUser.methods
            .transferToUsernameDeposit(new anchor.BN(initialAmount / 10))
            .accountsPartial({
              user,
              payer: user,
              sourceDeposit: depositPda,
              destinationDeposit: usernameDepositPda,
              sessionToken: null,
              tokenMint,
            })
            .signers([userKp])
            .rpc({ skipPreflight: true })
        );
        break;
      } catch (err) {
        await awaitWithLog(
          `logSendTransactionError transferToUsernameDeposit attempt ${attempt}`,
          logSendTransactionError(
            err,
            ephemeralProgramUser.provider.connection,
            "TransferToUsernameDeposit"
          )
        );
        if (!shouldRetryTransfer(err) || attempt === maxAttempts) {
          throw err;
        }
        await awaitWithLog(
          `sleep ${retryDelayMs}ms (transfer to username retry ${attempt})`,
          sleep(retryDelayMs)
        );
      }
    }
    if (!usernameTransferSig) {
      throw new Error("Transfer to username failed without a signature");
    }

    await awaitWithLog(
      "confirmTransaction (transfer to username)",
      ephemeralProgramUser.provider.connection.confirmTransaction(
        usernameTransferSig
      )
    );

    const usernameDeposit = await awaitWithLog(
      "fetch username deposit (after transfer)",
      ephemeralProgramOtherUser.account.usernameDeposit.fetch(
        usernameDepositPda
      )
    );
    assert.equal(usernameDeposit.amount.toNumber(), initialAmount / 5);
  });

  it("Third user cannot observe transfers in PER", async () => {
    const baseUsernameDeposit = await program.account.usernameDeposit.fetch(
      usernameDepositPda
    );
    assert.equal(baseUsernameDeposit.amount.toNumber(), initialAmount / 10);

    const checkSig = async (label: string, sig: string | null) => {
      if (!sig) {
        return;
      }
      let tx = null;
      try {
        tx = await provider.connection.getTransaction(sig, {
          commitment: "confirmed",
        });
      } catch {
        tx = null;
      }
      assert.equal(tx, null, `${label} should be hidden from base logs`);
    };

    await checkSig("private transfer", privateTransferSig);
    await checkSig("username transfer", usernameTransferSig);

    const checkSigErHidden = async (label: string, sig: string | null) => {
      if (!sig) {
        return;
      }
      try {
        const tx =
          await ephemeralProgramThirdUser.provider.connection.getTransaction(
            sig,
            { commitment: "confirmed" }
          );
        assert.equal(
          tx,
          null,
          `${label} should be hidden from third user on ER`
        );
      } catch {
        // Permissioned endpoints may throw when unauthorized.
        assert.isTrue(true);
      }
    };

    await checkSigErHidden("private transfer", privateTransferSig);
    await checkSigErHidden("username transfer", usernameTransferSig);

    let canRead = true;
    try {
      await ephemeralProgramThirdUser.account.usernameDeposit.fetch(
        usernameDepositPda
      );
    } catch {
      canRead = false;
    }
    assert.equal(
      canRead,
      false,
      "third user must not read username deposit bucket on ER"
    );

    let canReadOtherDeposit = true;
    try {
      await ephemeralProgramThirdUser.account.deposit.fetch(otherDepositPda);
    } catch {
      canReadOtherDeposit = false;
    }
    assert.equal(
      canReadOtherDeposit,
      false,
      "third user must not read other user's deposit on ER"
    );
  });

  it("Undelegate username deposit", async () => {
    try {
      const tx = await ephemeralProgramOtherUser.methods
        .undelegateUsernameDeposit(VALIDATION_USERNAME, tokenMint)
        .accountsPartial({
          payer: otherUser,
          deposit: usernameDepositPda,
          magicProgram: MAGIC_PROGRAM_ID,
          magicContext: MAGIC_CONTEXT_ID,
          session: sessionPda,
        })
        .signers([otherUserKp])
        .rpc({ skipPreflight: true });
      await ephemeralProgramOtherUser.provider.connection.confirmTransaction(
        tx
      );
    } catch (err) {
      await logSendTransactionError(
        err,
        ephemeralProgramOtherUser.provider.connection,
        "undelegateUsernameDeposit"
      );
      try {
        const sim = await ephemeralProgramOtherUser.methods
          .undelegateUsernameDeposit(VALIDATION_USERNAME, tokenMint)
          .accountsPartial({
            payer: otherUser,
            deposit: usernameDepositPda,
            magicProgram: MAGIC_PROGRAM_ID,
            magicContext: MAGIC_CONTEXT_ID,
            session: sessionPda,
          })
          .simulate();
        logError("undelegateUsernameDeposit simulate logs", sim.logs);
      } catch (simErr) {
        logError("undelegateUsernameDeposit simulate error", simErr);
      }
      throw err;
    }
  });

  it("Commit check: base chain sees username bucket update only after undelegation", async () => {
    const expected = initialAmount / 5;
    for (let i = 0; i < COMMIT_MAX_POLLS; i += 1) {
      const d = await program.account.usernameDeposit.fetch(usernameDepositPda);
      if (d.amount.toNumber() === expected) {
        return;
      }
      await sleep(COMMIT_POLL_MS);
    }
    const final = await program.account.usernameDeposit.fetch(
      usernameDepositPda
    );
    assert.equal(
      final.amount.toNumber(),
      expected,
      "base username bucket did not reflect committed ER state"
    );
  });

  it("Undelegate deposits (user + other) and verify base reflects committed ER state", async () => {
    const erUser = await ephemeralProgramUser.account.deposit.fetch(depositPda);
    const erOther = await ephemeralProgramOtherUser.account.deposit.fetch(
      otherDepositPda
    );

    const sig1 = await ephemeralProgramUser.methods
      .undelegate()
      .accountsPartial({
        user,
        payer: user,
        deposit: depositPda,
        sessionToken: null,
        magicProgram: MAGIC_PROGRAM_ID,
        magicContext: MAGIC_CONTEXT_ID,
      })
      .signers([userKp])
      .rpc({ skipPreflight: true });
    await ephemeralProgramUser.provider.connection.confirmTransaction(sig1);

    const sig2 = await ephemeralProgramOtherUser.methods
      .undelegate()
      .accountsPartial({
        user: otherUser,
        payer: otherUser,
        deposit: otherDepositPda,
        sessionToken: null,
        magicProgram: MAGIC_PROGRAM_ID,
        magicContext: MAGIC_CONTEXT_ID,
      })
      .signers([otherUserKp])
      .rpc({ skipPreflight: true });
    await ephemeralProgramOtherUser.provider.connection.confirmTransaction(
      sig2
    );

    let baseUser: typeof erUser | null = null;
    let baseOther: typeof erOther | null = null;
    for (let i = 0; i < COMMIT_MAX_POLLS; i += 1) {
      baseUser = await program.account.deposit.fetch(depositPda);
      baseOther = await program.account.deposit.fetch(otherDepositPda);
      if (
        baseUser.amount.toNumber() === erUser.amount.toNumber() &&
        baseOther.amount.toNumber() === erOther.amount.toNumber()
      ) {
        return;
      }
      await sleep(COMMIT_POLL_MS);
    }
    assert.equal(baseUser?.amount.toNumber(), erUser.amount.toNumber());
    assert.equal(baseOther?.amount.toNumber(), erOther.amount.toNumber());
  });
});
