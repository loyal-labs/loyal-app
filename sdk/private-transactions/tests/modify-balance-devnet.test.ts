import { beforeAll, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  DELEGATION_PROGRAM_ID,
  findDepositPda,
  findVaultPda,
  LoyalPrivateTransactionsClient,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "../index";
import {
  getKaminoModifyBalanceAccountsForTokenMint,
  KLEND_PROGRAM_ID,
  USDC_MINT_DEVNET,
} from "../src/constants";

const RUN_DEVNET_MODIFY_BALANCE =
  process.env.RUN_DEVNET_MODIFY_BALANCE === "true";
const describeIfEnabled = RUN_DEVNET_MODIFY_BALANCE ? describe : describe.skip;

const BASE_DEVNET_RPC =
  process.env.BASE_DEVNET_RPC ?? "https://api.devnet.solana.com";
const BASE_DEVNET_WS =
  process.env.BASE_DEVNET_WS ??
  BASE_DEVNET_RPC.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
const PER_RPC_ENDPOINT =
  process.env.PER_RPC_ENDPOINT ?? "https://tee.magicblock.app";
const PER_WS_ENDPOINT =
  process.env.PER_WS_ENDPOINT ??
  PER_RPC_ENDPOINT.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
const SOLANA_KEYPAIR_PATH =
  process.env.SOLANA_KEYPAIR_PATH ??
  path.join(homedir(), ".config", "solana", "id.json");

const USDC_INCREASE_AMOUNT = BigInt(
  process.env.USDC_TEST_AMOUNT ?? "200000"
);
const WSOL_INCREASE_AMOUNT = BigInt(
  process.env.WSOL_TEST_AMOUNT ?? String(Math.floor(LAMPORTS_PER_SOL / 200))
);
const TX_POLL_ATTEMPTS = 30;
const TX_POLL_DELAY_MS = 1_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadKeypair(keypairPath: string): Promise<Keypair> {
  const secret = JSON.parse(await readFile(keypairPath, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function getTokenAmountOrZero(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<bigint> {
  try {
    const account = await getAccount(
      connection,
      tokenAccount,
      "confirmed",
      TOKEN_PROGRAM_ID
    );
    return account.amount;
  } catch {
    return 0n;
  }
}

async function waitForTransaction(
  connection: Connection,
  signature: string
): Promise<VersionedTransactionResponse> {
  for (let attempt = 0; attempt < TX_POLL_ATTEMPTS; attempt += 1) {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx) {
      return tx;
    }
    await sleep(TX_POLL_DELAY_MS);
  }

  throw new Error(`Transaction ${signature} was not available on RPC`);
}

function hasProgramLog(
  tx: VersionedTransactionResponse,
  programId: PublicKey
): boolean {
  return (
    tx.meta?.logMessages?.some((line) => line.includes(programId.toBase58())) ??
    false
  );
}

async function wrapSolToWSol(opts: {
  connection: Connection;
  payer: Keypair;
  lamports: bigint;
}): Promise<{ wsolAta: PublicKey; createdAta: boolean }> {
  const { connection, payer, lamports } = opts;
  const wsolAta = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    payer.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );

  const instructions = [];
  const ataInfo = await connection.getAccountInfo(wsolAta, "confirmed");
  const createdAta = !ataInfo;

  if (!ataInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        wsolAta,
        payer.publicKey,
        NATIVE_MINT,
        TOKEN_PROGRAM_ID
      )
    );
  }

  instructions.push(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: wsolAta,
      lamports: Number(lamports),
    }),
    createSyncNativeInstruction(wsolAta, TOKEN_PROGRAM_ID)
  );

  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(...instructions),
    [payer],
    { commitment: "confirmed" }
  );

  return { wsolAta, createdAta };
}

async function closeWsolAta(opts: {
  connection: Connection;
  payer: Keypair;
  wsolAta: PublicKey;
}): Promise<void> {
  const { connection, payer, wsolAta } = opts;
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      createCloseAccountInstruction(
        wsolAta,
        payer.publicKey,
        payer.publicKey,
        [],
        TOKEN_PROGRAM_ID
      )
    ),
    [payer],
    { commitment: "confirmed" }
  );
}

async function ensureBaseDepositReady(opts: {
  client: LoyalPrivateTransactionsClient;
  connection: Connection;
  owner: Keypair;
  tokenMint: PublicKey;
}) {
  const { client, connection, owner, tokenMint } = opts;
  const [depositPda] = findDepositPda(owner.publicKey, tokenMint);
  const depositAccountInfo = await connection.getAccountInfo(
    depositPda,
    "confirmed"
  );

  if (!depositAccountInfo) {
    await client.initializeDeposit({
      user: owner.publicKey,
      tokenMint,
      payer: owner.publicKey,
      rpcOptions: { skipPreflight: true },
    });
  } else if (depositAccountInfo.owner.equals(DELEGATION_PROGRAM_ID)) {
    await client.undelegateDeposit({
      user: owner.publicKey,
      tokenMint,
      payer: owner.publicKey,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
      rpcOptions: { skipPreflight: true },
    });
  }

  const deposit = await client.getBaseDeposit(owner.publicKey, tokenMint);
  if (!deposit) {
    throw new Error(
      `Deposit PDA ${depositPda.toBase58()} was not available on base layer`
    );
  }

  return { depositPda, deposit };
}

describeIfEnabled("modify_balance devnet integration", () => {
  let connection: Connection;
  let userKeypair: Keypair;
  let loyalClient: LoyalPrivateTransactionsClient;

  beforeAll(async () => {
    connection = new Connection(BASE_DEVNET_RPC, {
      wsEndpoint: BASE_DEVNET_WS,
      commitment: "confirmed",
    });
    userKeypair = await loadKeypair(SOLANA_KEYPAIR_PATH);

    loyalClient = await LoyalPrivateTransactionsClient.fromConfig({
      signer: userKeypair,
      baseRpcEndpoint: BASE_DEVNET_RPC,
      baseWsEndpoint: BASE_DEVNET_WS,
      ephemeralRpcEndpoint: PER_RPC_ENDPOINT,
      ephemeralWsEndpoint: PER_WS_ENDPOINT,
      commitment: "confirmed",
    });

    const solBalance = await connection.getBalance(
      userKeypair.publicKey,
      "confirmed"
    );
    expect(solBalance > Math.floor(0.02 * LAMPORTS_PER_SOL)).toBe(true);
  });

  it("routes devnet USDC deposits through Kamino and redeems shares on withdraw", async () => {
    const user = userKeypair.publicKey;
    const tokenMint = USDC_MINT_DEVNET;
    const kaminoAccounts =
      getKaminoModifyBalanceAccountsForTokenMint(tokenMint);

    expect(kaminoAccounts).not.toBeNull();
    if (!kaminoAccounts) {
      throw new Error("USDC Kamino accounts were not configured");
    }

    const userTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      user,
      false,
      TOKEN_PROGRAM_ID
    );
    const [vaultPda] = findVaultPda(tokenMint);
    const vaultTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );
    const vaultCollateralTokenAccount = getAssociatedTokenAddressSync(
      kaminoAccounts.reserveCollateralMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );

    const { deposit: depositBefore } = await ensureBaseDepositReady({
      client: loyalClient,
      connection,
      owner: userKeypair,
      tokenMint,
    });

    const userUsdcBefore = await getTokenAmountOrZero(connection, userTokenAccount);
    const vaultLiquidityBefore = await getTokenAmountOrZero(
      connection,
      vaultTokenAccount
    );
    const vaultCollateralBefore = await getTokenAmountOrZero(
      connection,
      vaultCollateralTokenAccount
    );

    expect(userUsdcBefore >= USDC_INCREASE_AMOUNT).toBe(true);

    const increaseResult = await loyalClient.modifyBalance({
      user,
      tokenMint,
      amount: USDC_INCREASE_AMOUNT,
      increase: true,
      payer: user,
      userTokenAccount,
      rpcOptions: { skipPreflight: true },
    });

    const increaseTx = await waitForTransaction(
      connection,
      increaseResult.signature
    );
    const depositAfterIncrease = await loyalClient.getBaseDeposit(user, tokenMint);
    const userUsdcAfterIncrease = await getTokenAmountOrZero(
      connection,
      userTokenAccount
    );
    const vaultLiquidityAfterIncrease = await getTokenAmountOrZero(
      connection,
      vaultTokenAccount
    );
    const vaultCollateralAfterIncrease = await getTokenAmountOrZero(
      connection,
      vaultCollateralTokenAccount
    );

    expect(hasProgramLog(increaseTx, KLEND_PROGRAM_ID)).toBe(true);
    expect(depositAfterIncrease).not.toBeNull();
    expect(userUsdcBefore - userUsdcAfterIncrease).toBe(USDC_INCREASE_AMOUNT);
    expect(vaultLiquidityAfterIncrease).toBe(vaultLiquidityBefore);
    expect(vaultCollateralAfterIncrease > vaultCollateralBefore).toBe(true);

    const mintedShareDelta =
      depositAfterIncrease!.amount - depositBefore.amount;
    expect(mintedShareDelta > 0n).toBe(true);
    expect(vaultCollateralAfterIncrease - vaultCollateralBefore).toBe(
      mintedShareDelta
    );

    const decreaseResult = await loyalClient.modifyBalance({
      user,
      tokenMint,
      amount: mintedShareDelta,
      increase: false,
      payer: user,
      userTokenAccount,
      rpcOptions: { skipPreflight: true },
    });

    const decreaseTx = await waitForTransaction(
      connection,
      decreaseResult.signature
    );
    const depositAfterDecrease = await loyalClient.getBaseDeposit(user, tokenMint);
    const userUsdcAfterDecrease = await getTokenAmountOrZero(
      connection,
      userTokenAccount
    );
    const vaultLiquidityAfterDecrease = await getTokenAmountOrZero(
      connection,
      vaultTokenAccount
    );
    const vaultCollateralAfterDecrease = await getTokenAmountOrZero(
      connection,
      vaultCollateralTokenAccount
    );

    expect(hasProgramLog(decreaseTx, KLEND_PROGRAM_ID)).toBe(true);
    expect(depositAfterDecrease).not.toBeNull();
    expect(depositAfterDecrease!.amount).toBe(depositBefore.amount);
    expect(userUsdcAfterDecrease > userUsdcAfterIncrease).toBe(true);
    expect(vaultLiquidityAfterDecrease).toBe(vaultLiquidityBefore);
    expect(vaultCollateralAfterDecrease).toBe(vaultCollateralBefore);
  });

  it("uses the regular vault path for wSOL without any Kamino CPI", async () => {
    const user = userKeypair.publicKey;
    const tokenMint = NATIVE_MINT;
    const [vaultPda] = findVaultPda(tokenMint);

    await ensureBaseDepositReady({
      client: loyalClient,
      connection,
      owner: userKeypair,
      tokenMint,
    });

    const { wsolAta, createdAta } = await wrapSolToWSol({
      connection,
      payer: userKeypair,
      lamports: WSOL_INCREASE_AMOUNT,
    });

    const depositBefore = await loyalClient.getBaseDeposit(user, tokenMint);
    const userWsolBefore = await getTokenAmountOrZero(connection, wsolAta);
    const vaultTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      vaultPda,
      true,
      TOKEN_PROGRAM_ID
    );
    const vaultWsolBefore = await getTokenAmountOrZero(
      connection,
      vaultTokenAccount
    );

    expect(depositBefore).not.toBeNull();
    expect(userWsolBefore >= WSOL_INCREASE_AMOUNT).toBe(true);

    const increaseResult = await loyalClient.modifyBalance({
      user,
      tokenMint,
      amount: WSOL_INCREASE_AMOUNT,
      increase: true,
      payer: user,
      userTokenAccount: wsolAta,
      rpcOptions: { skipPreflight: true },
    });

    const increaseTx = await waitForTransaction(
      connection,
      increaseResult.signature
    );
    const depositAfterIncrease = await loyalClient.getBaseDeposit(user, tokenMint);
    const userWsolAfterIncrease = await getTokenAmountOrZero(connection, wsolAta);
    const vaultWsolAfterIncrease = await getTokenAmountOrZero(
      connection,
      vaultTokenAccount
    );

    expect(hasProgramLog(increaseTx, KLEND_PROGRAM_ID)).toBe(false);
    expect(depositAfterIncrease).not.toBeNull();
    expect(depositAfterIncrease!.amount - depositBefore!.amount).toBe(
      WSOL_INCREASE_AMOUNT
    );
    expect(userWsolBefore - userWsolAfterIncrease).toBe(WSOL_INCREASE_AMOUNT);
    expect(vaultWsolAfterIncrease - vaultWsolBefore).toBe(WSOL_INCREASE_AMOUNT);

    const decreaseResult = await loyalClient.modifyBalance({
      user,
      tokenMint,
      amount: WSOL_INCREASE_AMOUNT,
      increase: false,
      payer: user,
      userTokenAccount: wsolAta,
      rpcOptions: { skipPreflight: true },
    });

    const decreaseTx = await waitForTransaction(
      connection,
      decreaseResult.signature
    );
    const depositAfterDecrease = await loyalClient.getBaseDeposit(user, tokenMint);
    const userWsolAfterDecrease = await getTokenAmountOrZero(connection, wsolAta);
    const vaultWsolAfterDecrease = await getTokenAmountOrZero(
      connection,
      vaultTokenAccount
    );

    expect(hasProgramLog(decreaseTx, KLEND_PROGRAM_ID)).toBe(false);
    expect(depositAfterDecrease).not.toBeNull();
    expect(depositAfterDecrease!.amount).toBe(depositBefore!.amount);
    expect(userWsolAfterDecrease).toBe(userWsolBefore);
    expect(vaultWsolAfterDecrease).toBe(vaultWsolBefore);

    if (createdAta) {
      await closeWsolAta({
        connection,
        payer: userKeypair,
        wsolAta,
      });
    }
  });
});
