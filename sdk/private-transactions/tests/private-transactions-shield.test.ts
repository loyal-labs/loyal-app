import { describe, expect } from "bun:test";
import * as anchor from "@coral-xyz/anchor";
import {
  findDepositPda,
  LoyalPrivateTransactionsClient,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  PROGRAM_ID,
  ER_VALIDATOR,
  findUsernameDepositPda,
  DELEGATION_PROGRAM_ID,
} from "../index";
import {
  Connection,
  Ed25519Program,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  createMint,
  createSyncNativeInstruction,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  transfer,
} from "@solana/spl-token";
import {
  verifyTeeRpcIntegrity,
  getAuthToken,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { sign } from "tweetnacl";
import path from "node:path";
import type { TelegramVerification } from "../../../target/types/telegram_verification";

const AUTH_TOKEN_CACHE_PATH = path.join(
  import.meta.dir,
  ".auth-token-cache.json"
);

type CachedTokens = Record<string, { token: string; expiresAt: number }>;

async function loadTokenCache(): Promise<CachedTokens> {
  const file = Bun.file(AUTH_TOKEN_CACHE_PATH);
  if (!(await file.exists())) return {};
  try {
    return await file.json();
  } catch {
    return {};
  }
}

async function saveTokenCache(cache: CachedTokens): Promise<void> {
  await Bun.write(AUTH_TOKEN_CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function getOrCacheAuthToken(
  ephemeralRpcEndpoint: string,
  keypair: Keypair
): Promise<{ token: string; expiresAt: number }> {
  const cacheKey = `${ephemeralRpcEndpoint}:${keypair.publicKey.toBase58()}`;
  const cache = await loadTokenCache();
  const cached = cache[cacheKey];

  if (cached && cached.expiresAt > Date.now() + 60_000) {
    console.log(`Using cached auth token for ${keypair.publicKey.toBase58()}`);
    return cached;
  }

  const isVerified = await verifyTeeRpcIntegrity(ephemeralRpcEndpoint);
  if (!isVerified) {
    throw new Error("TEE RPC integrity verification failed");
  }

  const signMessage = (message: Uint8Array) =>
    Promise.resolve(sign.detached(message, keypair.secretKey));

  const result = await getAuthToken(
    ephemeralRpcEndpoint,
    keypair.publicKey,
    signMessage
  );

  cache[cacheKey] = result;
  await saveTokenCache(cache);
  console.log(`Cached new auth token for ${keypair.publicKey.toBase58()}`);
  return result;
}

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
const TELEGRAM_ED25519_PUBKEY = Buffer.from(
  "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d",
  "hex"
);

const PER_RPC_ENDPOINT = "https://tee.magicblock.app";
const PER_WS_ENDPOINT = "wss://tee.magicblock.app";

// const PER_RPC_ENDPOINT = "https://devnet-as.magicblock.app";
// const PER_WS_ENDPOINT = "wss://devnet-as.magicblock.app";

export const SECURE_DEVNET_RPC_URL =
  "https://aurora-o23cd4-fast-devnet.helius-rpc.com";
export const SECURE_DEVNET_RPC_WS =
  "wss://aurora-o23cd4-fast-devnet.helius-rpc.com";

const solanaConnection = new Connection(SECURE_DEVNET_RPC_URL, {
  wsEndpoint: SECURE_DEVNET_RPC_WS,
  commitment: "confirmed" as const,
});

// 4WRGdAZ8LHmbPC3CfdCR8sspKhBATs9EZ8H83RYJQ8RG
const USER_KP = Keypair.fromSecretKey(
  Uint8Array.from([
    54, 229, 115, 67, 69, 71, 205, 239, 251, 81, 102, 40, 48, 237, 241, 66, 8,
    22, 241, 216, 209, 140, 214, 111, 51, 58, 171, 169, 14, 90, 182, 255, 52,
    28, 88, 128, 77, 91, 157, 211, 179, 122, 209, 150, 17, 24, 121, 242, 177,
    212, 235, 216, 109, 5, 94, 31, 222, 100, 124, 166, 124, 52, 149, 131,
  ])
);
// 3cd5zjx8DAPDUciSrJtbrtniuNpDWhGLSKtk7xxCMCpP
const OTHER_USER_KP = Keypair.fromSecretKey(
  Uint8Array.from([
    112, 50, 255, 102, 148, 177, 8, 136, 48, 146, 49, 69, 16, 165, 113, 81, 123,
    225, 207, 149, 216, 229, 105, 50, 249, 48, 232, 27, 165, 181, 239, 97, 38,
    215, 129, 64, 75, 228, 54, 138, 179, 234, 24, 136, 233, 6, 252, 59, 233,
    186, 135, 194, 87, 255, 97, 59, 189, 140, 157, 56, 221, 35, 43, 56,
  ])
);

const USER = USER_KP.publicKey;
const OTHER_USER = OTHER_USER_KP.publicKey;

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

const userAuthToken = await getOrCacheAuthToken(PER_RPC_ENDPOINT, USER_KP);
const otherAuthToken = await getOrCacheAuthToken(
  PER_RPC_ENDPOINT,
  OTHER_USER_KP
);

const loyalClient = await LoyalPrivateTransactionsClient.fromConfig({
  signer: USER_KP,
  baseRpcEndpoint: SECURE_DEVNET_RPC_URL,
  baseWsEndpoint: SECURE_DEVNET_RPC_WS,
  ephemeralRpcEndpoint: PER_RPC_ENDPOINT,
  ephemeralWsEndpoint: PER_WS_ENDPOINT,
  authToken: userAuthToken,
});

const otherLoyalClient = await LoyalPrivateTransactionsClient.fromConfig({
  signer: OTHER_USER_KP,
  baseRpcEndpoint: SECURE_DEVNET_RPC_URL,
  baseWsEndpoint: SECURE_DEVNET_RPC_WS,
  ephemeralRpcEndpoint: PER_RPC_ENDPOINT,
  ephemeralWsEndpoint: PER_WS_ENDPOINT,
  authToken: otherAuthToken,
});

export const COMMON_MINTS = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  CUST: "FiuhQjmbHuCi15VMowXaecYKma5GhovNzaU2EBv3rk6",
} as const;

export async function wrapSolToWSol(opts: {
  connection: Connection;
  payer: Keypair;
  lamports: number;
}): Promise<{ wsolAta: PublicKey; createdAta: boolean }> {
  const { connection, payer, lamports } = opts;

  const wsolAta = await getAssociatedTokenAddress(NATIVE_MINT, payer.publicKey);

  const instructions: TransactionInstruction[] = [];
  let createdAta = false;

  const ataInfo = await connection.getAccountInfo(wsolAta);
  if (!ataInfo) {
    createdAta = true;
    instructions.push(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        wsolAta,
        payer.publicKey,
        NATIVE_MINT
      )
    );
  }

  instructions.push(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: wsolAta,
      lamports,
    })
  );

  instructions.push(createSyncNativeInstruction(wsolAta));

  const tx = new Transaction().add(...instructions);
  await sendAndConfirmTransaction(connection, tx, [payer]);

  return { wsolAta, createdAta };
}

export async function closeWsolAta(opts: {
  connection: Connection;
  payer: Keypair;
  wsolAta: PublicKey;
}): Promise<void> {
  const { connection, payer, wsolAta } = opts;

  try {
    const closeTx = new Transaction().add(
      createCloseAccountInstruction(wsolAta, payer.publicKey, payer.publicKey)
    );
    await sendAndConfirmTransaction(connection, closeTx, [payer]);
  } catch (error) {
    console.error("Failed to close wSOL ATA", error);
  }
}

/**
 * Check which tokens have Loyal deposits. Returns a map of mint → deposit amount (raw).
 */
export async function fetchLoyalDeposits(
  userPublicKey: PublicKey,
  tokenMints: string[]
): Promise<Map<string, number>> {
  const deposits = new Map<string, number>();

  const results = await Promise.allSettled(
    tokenMints.map(async (mint) => {
      const mintPubkey = new PublicKey(mint);
      const baseDeposit = await loyalClient.getBaseDeposit(
        userPublicKey,
        mintPubkey
      );
      const ephemeralDeposit = await loyalClient.getEphemeralDeposit(
        userPublicKey,
        mintPubkey
      );
      if (ephemeralDeposit && ephemeralDeposit.amount > 0) {
        console.log(
          "ephemeralDeposit",
          mintPubkey.toString(),
          ephemeralDeposit.amount
        );
        deposits.set(mint, Number(ephemeralDeposit.amount));
      } else if (baseDeposit && baseDeposit.amount > 0) {
        console.log("baseDeposit", mintPubkey.toString(), baseDeposit.amount);
        deposits.set(mint, Number(baseDeposit.amount));
      }
    })
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("[loyal-deposits] Failed to check deposit:", result.reason);
    }
  }

  return deposits;
}

const getConnection = () => solanaConnection;
const getWalletKeypair = async () => USER_KP;
const getLoyalClient = async () => loyalClient;
const getOtherLoyalClient = async () => otherLoyalClient;

async function waitForAccount(
  client: LoyalPrivateTransactionsClient,
  pda: PublicKey,
  maxAttempts = 30
): Promise<void> {
  const connection = client.baseProgram.provider.connection;
  for (let i = 0; i < maxAttempts; i++) {
    const info = await connection.getAccountInfo(pda);
    if (info) return;
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function claimTokens(params: {
  tokenMint: PublicKey;
  amount: number;
  username: string;
  destination: PublicKey;
  session: PublicKey;
}): Promise<string> {
  const startTime = Date.now();
  console.log("> claimTokens");
  const client = await getOtherLoyalClient();
  const { tokenMint, amount, username, destination, session } = params;

  const [usernameDepositPda] = findUsernameDepositPda(username, tokenMint);
  const baseUsernameDepositAccountInfo =
    await client.baseProgram.provider.connection.getAccountInfo(
      usernameDepositPda
    );
  const isUsernameDelegated = baseUsernameDepositAccountInfo?.owner.equals(
    DELEGATION_PROGRAM_ID
  );

  if (!isUsernameDelegated) {
    const keypair = await getWalletKeypair();
    console.log("delegateUsernameDeposit");
    const delegateUsernameDepositSig = await client.delegateUsernameDeposit({
      tokenMint,
      username,
      payer: keypair.publicKey,
      validator: ER_VALIDATOR,
    });
    console.log("delegateUsernameDeposit sig", delegateUsernameDepositSig);
  }

  const [depositPda] = findDepositPda(destination, tokenMint);
  const baseDepositAccountInfo =
    await client.baseProgram.provider.connection.getAccountInfo(depositPda);
  const isDelegated = baseDepositAccountInfo?.owner.equals(
    DELEGATION_PROGRAM_ID
  );

  if (!isDelegated) {
    console.log("delegateUsernameDeposit");
    const delegateDepositSig = await client.delegateDeposit({
      user: destination,
      tokenMint,
      payer: destination,
      validator: ER_VALIDATOR,
    });
    console.log("delegateDepositSig sig", delegateDepositSig);
  }

  console.log("claimUsernameDepositToDeposit");
  const claimUsernameDepositToDepositSig =
    await client.claimUsernameDepositToDeposit({
      username,
      tokenMint,
      amount,
      recipient: destination,
      session,
    });
  console.log(
    "claimUsernameDepositToDeposit sig",
    claimUsernameDepositToDepositSig
  );

  console.log(`< claimTokens (${Date.now() - startTime}ms)`);

  return claimUsernameDepositToDepositSig;
}

export async function transferTokensToUsername(params: {
  tokenMint: PublicKey;
  amount: number;
  destinationUsername: string;
}): Promise<string> {
  const startTime = Date.now();
  console.log("> transferTokensToUsername");
  const keypair = await getWalletKeypair();
  const client = await getLoyalClient();
  const { tokenMint, amount, destinationUsername } = params;

  const existingBaseUsernameDeposit = await client.getBaseUsernameDeposit(
    destinationUsername,
    tokenMint
  );
  const existingEphemeralUsernameDeposit =
    await client.getEphemeralUsernameDeposit(destinationUsername, tokenMint);

  if (!existingBaseUsernameDeposit && !existingEphemeralUsernameDeposit) {
    console.log("initializeUsernameDeposit");
    const initializeUsernameDepositSig = await client.initializeUsernameDeposit(
      {
        tokenMint,
        username: destinationUsername,
        payer: keypair.publicKey,
      }
    );
    console.log("initializeUsernameDeposit sig", initializeUsernameDepositSig);
    const [depositPda] = findUsernameDepositPda(destinationUsername, tokenMint);
    await waitForAccount(client, depositPda);
  }

  const [depositPda] = findUsernameDepositPda(destinationUsername, tokenMint);
  const baseAccountInfo =
    await client.baseProgram.provider.connection.getAccountInfo(depositPda);
  const isDelegated = baseAccountInfo?.owner.equals(DELEGATION_PROGRAM_ID);

  if (!isDelegated) {
    console.log("delegateUsernameDeposit");
    const delegateUsernameDepositSig = await client.delegateUsernameDeposit({
      tokenMint,
      username: destinationUsername,
      payer: keypair.publicKey,
      validator: ER_VALIDATOR,
    });
    console.log("delegateUsernameDeposit sig", delegateUsernameDepositSig);
  }

  console.log("transferToUsernameDeposit");
  const transferToUsernameDepositSig = await client.transferToUsernameDeposit({
    username: destinationUsername,
    user: keypair.publicKey,
    tokenMint,
    amount,
    payer: keypair.publicKey,
  });
  console.log("transferToUsernameDeposit sig", transferToUsernameDepositSig);

  console.log(`< transferTokensToUsername (${Date.now() - startTime}ms)`);

  return transferToUsernameDepositSig;
}

export async function transferTokens(params: {
  tokenMint: PublicKey;
  amount: number;
  destination: PublicKey;
}): Promise<string> {
  const startTime = Date.now();
  console.log("> transferTokens");
  const keypair = await getWalletKeypair();
  const client = await getLoyalClient();
  const { tokenMint, amount, destination } = params;

  const existingBaseDeposit = await client.getBaseDeposit(
    destination,
    tokenMint
  );
  const existingEphemeralDeposit = await client.getEphemeralDeposit(
    destination,
    tokenMint
  );
  if (!existingBaseDeposit && !existingEphemeralDeposit) {
    console.log("initializeDeposit for destination user");
    const initializeDepositSig = await client.initializeDeposit({
      tokenMint,
      user: destination,
      payer: keypair.publicKey,
    });
    console.log("initializeDeposit sig", initializeDepositSig);

    const [depositPda] = findDepositPda(destination, tokenMint);
    await waitForAccount(client, depositPda);
  }

  const [depositPda] = findDepositPda(destination, tokenMint);
  const depositPdaAccountInfo =
    await client.baseProgram.provider.connection.getAccountInfo(depositPda);
  const isDelegated = depositPdaAccountInfo?.owner.equals(
    DELEGATION_PROGRAM_ID
  );

  if (!isDelegated) {
    console.log("delegateDeposit for destination user");
    const delegateDepositSig = await client.delegateDeposit({
      tokenMint,
      user: destination,
      payer: keypair.publicKey,
      validator: ER_VALIDATOR,
    });
    console.log("delegateDeposit sig", delegateDepositSig);
  }

  console.log("transferDeposit");
  const transferDepositSig = await client.transferDeposit({
    user: keypair.publicKey,
    tokenMint,
    destinationUser: destination,
    amount,
    payer: keypair.publicKey,
  });
  console.log("transferDeposit sig", transferDepositSig);

  console.log(`< transferTokens (${Date.now() - startTime}ms)`);

  return transferDepositSig;
}

/**
 * Shield tokens: move from regular wallet into Loyal private deposit.
 * Flow: initializeDeposit (if needed) → modifyBalance(increase) → createPermission → delegateDeposit
 */
export async function shieldTokens(params: {
  tokenMint: PublicKey;
  amount: number;
}): Promise<string> {
  const startTime = Date.now();
  console.log("> shieldTokens");
  const keypair = await getWalletKeypair();
  const client = await getLoyalClient();
  const { tokenMint, amount } = params;

  // 1. Initialize deposit if it doesn't exist yet
  const existingDeposit = await client.getBaseDeposit(
    keypair.publicKey,
    tokenMint
  );
  if (!existingDeposit) {
    console.log("initializeDeposit");
    const initializeDepositSig = await client.initializeDeposit({
      tokenMint,
      user: keypair.publicKey,
      payer: keypair.publicKey,
    });
    console.log("initializeDeposit sig", initializeDepositSig);
    const [depositPda] = findDepositPda(keypair.publicKey, tokenMint);
    await waitForAccount(client, depositPda);
  }

  // 2. Wrap native SOL → wSOL if needed
  const isNativeSol = tokenMint.equals(NATIVE_MINT);
  const connection = getConnection();
  let createdAta = false;

  if (isNativeSol) {
    const result = await wrapSolToWSol({
      connection,
      payer: keypair,
      lamports: amount,
    });
    console.log("wrapSolToWSol wsolAta: ", result.wsolAta.toString());
    createdAta = result.createdAta;
  }

  const userTokenAccount = getAssociatedTokenAddressSync(
    tokenMint,
    keypair.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );
  console.log("userTokenAccount", userTokenAccount.toString());

  // 3. Undelegate if currently delegated (modifyBalance requires base layer ownership)
  const [depositPda] = findDepositPda(keypair.publicKey, tokenMint);
  const depositAccountInfo =
    await client.baseProgram.provider.connection.getAccountInfo(depositPda);
  if (depositAccountInfo?.owner.equals(DELEGATION_PROGRAM_ID)) {
    console.log("undelegateDeposit (deposit is delegated, undelegating first)");
    const undelegateSig = await client.undelegateDeposit({
      tokenMint,
      user: keypair.publicKey,
      payer: keypair.publicKey,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
    });
    console.log("undelegateDeposit sig", undelegateSig);
  }

  // 4. Move tokens into the deposit vault
  console.log("modifyBalance");
  const { signature } = await client.modifyBalance({
    tokenMint,
    amount,
    increase: true,
    user: keypair.publicKey,
    payer: keypair.publicKey,
  });
  console.log("modifyBalance sig", signature);

  // Close temporary wSOL ATA if we created it
  if (isNativeSol && createdAta) {
    console.log("closeWsolAta");
    await closeWsolAta({
      connection,
      payer: keypair,
      wsolAta: userTokenAccount,
    });
    console.log("closeWsolAta done");
  }

  // 5. Create permission (may already exist)
  try {
    console.log("createPermission");
    const createPermissionSig = await client.createPermission({
      tokenMint,
      user: keypair.publicKey,
      payer: keypair.publicKey,
    });
    console.log("createPermission sig", createPermissionSig);
  } catch {
    // Permission may already exist, that's fine
  }

  // 6. Delegate deposit to PER
  try {
    console.log("delegateDeposit");
    const delegateDepositSig = await client.delegateDeposit({
      tokenMint,
      user: keypair.publicKey,
      payer: keypair.publicKey,
      validator: ER_VALIDATOR,
    });
    console.log("delegateDeposit sig", delegateDepositSig);
  } catch {
    // May already be delegated
  }

  console.log(`< shieldTokens (${Date.now() - startTime}ms)`);

  return signature;
}

/**
 * Unshield tokens: move from Loyal private deposit back to regular wallet.
 * Flow: undelegateDeposit (from PER to base layer) → modifyBalance(decrease) → unwrap wSOL if native → re-delegate remaining
 */
export async function unshieldTokens(params: {
  tokenMint: PublicKey;
  amount: number;
  otherClient?: LoyalPrivateTransactionsClient;
  otherKeypair?: Keypair;
}): Promise<string> {
  const startTime = Date.now();
  console.log("> unshieldTokens");

  const { tokenMint, amount, otherClient, otherKeypair } = params;

  const keypair = otherKeypair || (await getWalletKeypair());

  // 1. Undelegate from PER (waits for owner to be PROGRAM_ID on both connections)
  const client = otherClient || (await getLoyalClient());

  const connection = getConnection();

  console.log("undelegateDeposit");
  const undelegateDepositSig = await client.undelegateDeposit({
    tokenMint,
    user: keypair.publicKey,
    payer: keypair.publicKey,
    magicProgram: MAGIC_PROGRAM_ID,
    magicContext: MAGIC_CONTEXT_ID,
  });
  console.log("undelegateDeposit sig", undelegateDepositSig);

  // 2. Withdraw tokens back to regular wallet
  const isNativeSol = tokenMint.equals(NATIVE_MINT);

  // Ensure wSOL ATA exists for native SOL withdrawals
  if (isNativeSol) {
    await wrapSolToWSol({ connection, payer: keypair, lamports: 0 });
  }

  const userTokenAccount = getAssociatedTokenAddressSync(
    tokenMint,
    keypair.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );

  console.log("modifyBalance");
  const { signature } = await client.modifyBalance({
    tokenMint,
    amount,
    increase: false,
    user: keypair.publicKey,
    payer: keypair.publicKey,
  });
  console.log("modifyBalance sig", signature);

  // 3. Unwrap wSOL back to native SOL
  if (isNativeSol) {
    console.log("closeWsolAta");
    await closeWsolAta({
      connection,
      payer: keypair,
      wsolAta: userTokenAccount,
    });
    console.log("closeWsolAta done");
  }

  // 4. Re-delegate if there are remaining tokens in the deposit
  const remainingDeposit = await client.getBaseDeposit(
    keypair.publicKey,
    tokenMint
  );
  if (remainingDeposit && remainingDeposit.amount > 0n) {
    console.log(
      "delegateDeposit (remaining balance:",
      remainingDeposit.amount.toString(),
      ")"
    );
    const delegateDepositSig = await client.delegateDeposit({
      tokenMint,
      user: keypair.publicKey,
      payer: keypair.publicKey,
      validator: ER_VALIDATOR,
    });
    console.log("delegateDeposit sig", delegateDepositSig);
  }

  console.log(`< unshieldTokens (${Date.now() - startTime}ms)`);

  return signature;
}

describe("private-transactions shield SDK (PER)", async () => {
  console.log("_____________");
  console.log("wallet", USER.toString());

  const deposits = await fetchLoyalDeposits(USER, Object.values(COMMON_MINTS));
  console.log("deposits", deposits);

  const MINT_CACHE_PATH = path.join(import.meta.dir, ".mint-cache.json");
  const MINT_DECIMALS = 2;

  enum MintMode {
    CreateNew = "create_new",
    UseCached = "use_cached",
    NativeMint = "native_mint",
  }

  const MINT_MODE = MintMode.NativeMint as MintMode;

  let mint: PublicKey;

  if (MINT_MODE === MintMode.NativeMint) {
    mint = NATIVE_MINT;
    console.log("Using native mint:", mint.toString());
  } else if (MINT_MODE === MintMode.UseCached) {
    const cacheFile = Bun.file(MINT_CACHE_PATH);
    if (!(await cacheFile.exists())) {
      throw new Error(
        `Mint cache not found at ${MINT_CACHE_PATH}. Use MintMode.CreateNew first.`
      );
    }
    const cached = await cacheFile.json();
    mint = new PublicKey(cached.mint);
    console.log("Using cached mint:", mint.toString());
  } else {
    // MintMode.CreateNew
    mint = await createMint(
      solanaConnection,
      USER_KP, // payer
      USER, // mint authority
      USER, // freeze authority
      MINT_DECIMALS // decimals
    );
    await Bun.write(
      MINT_CACHE_PATH,
      JSON.stringify({ mint: mint.toString() }, null, 2)
    );
    console.log("Created new mint (cached):", mint.toString());
  }

  console.log("mint", mint.toString());

  if (MINT_MODE === MintMode.CreateNew) {
    // Mint tokens to wallet's ATA before depositing
    const ata = await getOrCreateAssociatedTokenAccount(
      solanaConnection,
      USER_KP, // payer
      mint, // mint
      USER // owner
    );
    console.log("ATA:", ata.address.toString());

    await mintTo(
      solanaConnection,
      USER_KP, // payer
      mint, // mint
      ata.address, // destination
      USER_KP, // mint authority
      3 * 10 ** MINT_DECIMALS // amount in base units
    );
    console.log(`Minted to wallet`);
  }

  const verificationIdl = JSON.parse(
    await Bun.file("../../target/idl/telegram_verification.json").text()
  ) as TelegramVerification;
  const verificationProvider = new anchor.AnchorProvider(
    loyalClient.baseProgram.provider.connection,
    new anchor.Wallet(OTHER_USER_KP)
  );
  const verificationProgram = new anchor.Program<TelegramVerification>(
    verificationIdl,
    verificationProvider
  );
  const [sessionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("tg_session"), OTHER_USER.toBuffer()],
    verificationProgram.programId
  );

  const subEmitter = verificationProgram.account.telegramSession.subscribe(
    sessionPda,
    "confirmed"
  );
  subEmitter.addListener("change", (arg) => {
    console.log("telegramSession changed: verified", arg.verified);
  });

  const showSession = async (tag: string) => {
    const telegramSessionAccountInfo =
      await verificationProgram.account.telegramSession.fetchNullable(
        sessionPda
      );
    console.log(
      "telegramSessionAccountInfo",
      tag,
      sessionPda.toString(),
      telegramSessionAccountInfo !== null
        ? telegramSessionAccountInfo.verified
        : "not exist"
    );
  };

  console.log("[sdk-test] store + verify telegram initData");
  await showSession("before store");
  console.log("store");
  const waitForVerified = (target: boolean) =>
    new Promise<void>((resolve) => {
      const listener = (arg: { verified: boolean }) => {
        if (arg.verified === target) {
          subEmitter.removeListener("change", listener);
          resolve();
        }
      };
      subEmitter.addListener("change", listener);
    });
  const verifiedBecameFalse = waitForVerified(false);
  await verificationProgram.methods
    .store(Buffer.from(VALIDATION_BYTES))
    .accounts({
      payer: OTHER_USER,
      user: OTHER_USER,
      // @ts-ignore
      session: sessionPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([OTHER_USER_KP])
    .rpc({ commitment: "confirmed" });
  console.log("store done, waiting for verified=false...");
  const currentSession =
    await verificationProgram.account.telegramSession.fetch(sessionPda);
  if (!currentSession.verified) {
    console.log("verified is already false");
  } else {
    await verifiedBecameFalse;
  }
  console.log("verified became false");
  await showSession("after store");

  const verifiedBecameTrue = waitForVerified(true);
  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: Uint8Array.from(TELEGRAM_ED25519_PUBKEY),
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
  const { blockhash } = await solanaConnection.getLatestBlockhash();
  verifyTx.feePayer = OTHER_USER;
  verifyTx.recentBlockhash = blockhash;
  verifyTx.sign(OTHER_USER_KP);
  const verifySig = await solanaConnection.sendRawTransaction(
    verifyTx.serialize()
  );
  console.log("verifySig", verifySig);
  await solanaConnection.confirmTransaction(verifySig, "confirmed");
  console.log("verifySig confirmed");

  const currentSessionAfterVerify =
    await verificationProgram.account.telegramSession.fetch(sessionPda);
  if (currentSessionAfterVerify.verified) {
    console.log("verified is already true");
  } else {
    await verifiedBecameTrue;
  }
  console.log("verified became true");

  await showSession("after verify");

  await verificationProgram.account.telegramSession.unsubscribe(sessionPda);

  let amount;
  if (MINT_MODE === MintMode.NativeMint) {
    amount = LAMPORTS_PER_SOL / 10;
  } else {
    amount = 1 * 10 ** 2;
  }
  const doubleAmount = 2 * amount;

  const username = VALIDATION_USERNAME;
  const isNativeSol = mint.equals(NATIVE_MINT);

  const otherUserUsernameDepositBefore =
    await loyalClient.getEphemeralUsernameDeposit(username, mint);
  console.log(
    "otherUserUsernameDeposit amount before",
    otherUserUsernameDepositBefore?.amount?.toString()
  );
  if (otherUserUsernameDepositBefore?.amount) {
    await claimTokens({
      tokenMint: mint,
      amount: Number(otherUserUsernameDepositBefore?.amount),
      username,
      destination: OTHER_USER,
      session: sessionPda,
    });
  }

  const userDepositBefore = await loyalClient.getBaseDeposit(USER, mint);
  const otherUserDepositBefore = await otherLoyalClient.getBaseDeposit(
    OTHER_USER,
    mint
  );
  console.log(
    "userDeposit amount before",
    userDepositBefore?.amount?.toString()
  );
  console.log(
    "otherUserDeposit amount before",
    otherUserDepositBefore?.amount?.toString()
  );
  if (userDepositBefore?.amount) {
    await unshieldTokens({
      tokenMint: mint,
      amount: Number(userDepositBefore!.amount),
    });
  }
  if (otherUserDepositBefore?.amount) {
    await unshieldTokens({
      tokenMint: mint,
      amount: Number(otherUserDepositBefore!.amount),
      otherClient: otherLoyalClient,
      otherKeypair: OTHER_USER_KP,
    });
  }

  const shieldSig1 = await shieldTokens({ tokenMint: mint, amount: amount });
  const shieldSig2 = await shieldTokens({
    tokenMint: mint,
    amount: doubleAmount,
  });

  await transferTokensToUsername({
    tokenMint: mint,
    amount: amount / 2,
    destinationUsername: username,
  });
  await transferTokensToUsername({
    tokenMint: mint,
    amount: amount / 2,
    destinationUsername: username,
  });

  await transferTokens({
    tokenMint: mint,
    amount: amount / 2,
    destination: OTHER_USER,
  });
  await transferTokens({
    tokenMint: mint,
    amount: amount / 2,
    destination: OTHER_USER,
  });

  await claimTokens({
    tokenMint: mint,
    amount: amount / 2,
    username,
    destination: OTHER_USER,
    session: sessionPda,
  });
  await claimTokens({
    tokenMint: mint,
    amount: amount / 2,
    username,
    destination: OTHER_USER,
    session: sessionPda,
  });

  const unshieldSig1 = await unshieldTokens({ tokenMint: mint, amount });
  const unshieldSig2 = await unshieldTokens({
    tokenMint: mint,
    amount: doubleAmount,
    otherClient: otherLoyalClient,
    otherKeypair: OTHER_USER_KP,
  });

  // --- Verification checks after all shield/transfer/claim/unshield operations ---
  console.log("=== Verification checks ===");

  // 1. Check each modifyBalance transaction transferred the expected token amount.
  //    This avoids overall SOL balance comparison which is noisy from tx fees, rent, and wSOL wrapping.
  async function getModifyBalanceTokenDelta(
    sig: string,
    ownerPubkey: PublicKey
  ): Promise<number> {
    const tx = await solanaConnection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx || !tx.meta) throw new Error(`Transaction ${sig} not found`);

    const ownerStr = ownerPubkey.toBase58();
    const mintStr = mint.toBase58();

    const preBal = tx.meta.preTokenBalances?.find(
      (b) => b.owner === ownerStr && b.mint === mintStr
    );
    const postBal = tx.meta.postTokenBalances?.find(
      (b) => b.owner === ownerStr && b.mint === mintStr
    );

    const pre = Number(preBal?.uiTokenAmount?.amount ?? "0");
    const post = Number(postBal?.uiTokenAmount?.amount ?? "0");
    return post - pre;
  }

  // Shield: user's token account should decrease by the shielded amount
  const shieldDelta1 = await getModifyBalanceTokenDelta(shieldSig1, USER);
  const shieldDelta2 = await getModifyBalanceTokenDelta(shieldSig2, USER);
  console.log("shieldDelta1", shieldDelta1, "expected", -amount);
  console.log("shieldDelta2", shieldDelta2, "expected", -doubleAmount);
  expect(shieldDelta1).toBe(-amount);
  expect(shieldDelta2).toBe(-doubleAmount);
  console.log("Shield modifyBalance checks passed");

  // Unshield: user's token account should increase by the unshielded amount
  const unshieldDelta1 = await getModifyBalanceTokenDelta(unshieldSig1, USER);
  const unshieldDelta2 = await getModifyBalanceTokenDelta(
    unshieldSig2,
    OTHER_USER
  );
  console.log("unshieldDelta1", unshieldDelta1, "expected", amount);
  console.log("unshieldDelta2", unshieldDelta2, "expected", doubleAmount);
  expect(unshieldDelta1).toBe(amount);
  expect(unshieldDelta2).toBe(doubleAmount);
  console.log("Unshield modifyBalance checks passed");

  // 2. Check deposit accounts have zero balances and correct owners (undelegated = owned by PROGRAM_ID)
  const [userDepositPda] = findDepositPda(USER, mint);
  const [otherUserDepositPda] = findDepositPda(OTHER_USER, mint);

  const userDeposit = await loyalClient.getBaseDeposit(USER, mint);
  const otherUserDeposit = await otherLoyalClient.getBaseDeposit(
    OTHER_USER,
    mint
  );
  console.log("userDeposit amount", userDeposit?.amount?.toString());
  console.log("otherUserDeposit amount", otherUserDeposit?.amount?.toString());

  expect(userDeposit).not.toBeNull();
  expect(userDeposit!.amount).toBe(0n);
  expect(otherUserDeposit).not.toBeNull();
  expect(otherUserDeposit!.amount).toBe(0n);
  console.log("Deposit amounts are zero — passed");

  // 3. Check deposit account owners — after unshield, deposits with 0 balance get re-delegated
  //    only if remaining balance > 0 (see unshieldTokens). With 0 balance, they stay on base layer.
  const userDepositAccountInfo = await solanaConnection.getAccountInfo(
    userDepositPda
  );
  const otherUserDepositAccountInfo = await solanaConnection.getAccountInfo(
    otherUserDepositPda
  );

  expect(userDepositAccountInfo).not.toBeNull();
  expect(otherUserDepositAccountInfo).not.toBeNull();
  // Zero-balance deposits should NOT be re-delegated — owner should be PROGRAM_ID
  expect(userDepositAccountInfo!.owner.equals(PROGRAM_ID)).toBe(true);
  expect(otherUserDepositAccountInfo!.owner.equals(PROGRAM_ID)).toBe(true);
  console.log("Deposit accounts owned by PROGRAM_ID (not delegated) — passed");

  // 4. Check username deposit account
  const [usernameDepositPda] = findUsernameDepositPda(username, mint);
  const usernameDepositAccountInfo = await solanaConnection.getAccountInfo(
    usernameDepositPda
  );
  if (usernameDepositAccountInfo) {
    console.log(
      "usernameDeposit owner",
      usernameDepositAccountInfo.owner.toBase58(),
      "isDelegated",
      usernameDepositAccountInfo.owner.equals(DELEGATION_PROGRAM_ID)
    );
  }

  const usernameDeposit = await loyalClient.getBaseUsernameDeposit(
    username,
    mint
  );
  const usernameDepositEphemeral =
    await loyalClient.getEphemeralUsernameDeposit(username, mint);
  console.log("usernameDeposit amount", usernameDeposit?.amount?.toString());
  console.log(
    "usernameDepositEphemeral amount",
    usernameDepositEphemeral?.amount?.toString()
  );

  // All username deposit funds were claimed — amount should be 0 on at least one layer
  const usernameDepositAmount =
    usernameDepositEphemeral?.amount ?? usernameDeposit?.amount ?? 0n;
  expect(usernameDepositAmount).toBe(0n);
  console.log("Username deposit amount is zero — passed");

  // Username deposit should still be delegated (claims happen on ephemeral layer)

  if (usernameDepositAccountInfo) {
    expect(usernameDepositAccountInfo.owner.equals(DELEGATION_PROGRAM_ID)).toBe(
      true
    );
  }
  console.log("Username deposit delegation check — passed");

  // 5. Check no wSOL ATAs left for either user (unshield closes them for native SOL)
  if (isNativeSol) {
    const userWsolAta = getAssociatedTokenAddressSync(
      NATIVE_MINT,
      USER,
      false,
      TOKEN_PROGRAM_ID
    );
    const otherUserWsolAta = getAssociatedTokenAddressSync(
      NATIVE_MINT,
      OTHER_USER,
      false,
      TOKEN_PROGRAM_ID
    );

    const userWsolInfo = await solanaConnection.getAccountInfo(userWsolAta);
    const otherUserWsolInfo = await solanaConnection.getAccountInfo(
      otherUserWsolAta
    );

    console.log("userWsolAta exists", !!userWsolInfo);
    console.log("otherUserWsolAta exists", !!otherUserWsolInfo);

    expect(userWsolInfo).toBeNull();
    expect(otherUserWsolInfo).toBeNull();
    console.log("No wSOL ATAs left — passed");
  }

  console.log("=== All verification checks passed ===");

  // Transfer back — re-wrap SOL into wSOL if native mint since unshieldTokens closed the ATA
  if (isNativeSol) {
    await wrapSolToWSol({
      connection: solanaConnection,
      payer: OTHER_USER_KP,
      lamports: doubleAmount,
    });
  }
  const otherUserAta = (
    await getOrCreateAssociatedTokenAccount(
      solanaConnection,
      OTHER_USER_KP,
      mint,
      OTHER_USER
    )
  ).address;
  const userAta = (
    await getOrCreateAssociatedTokenAccount(
      solanaConnection,
      OTHER_USER_KP,
      mint,
      USER
    )
  ).address;
  const transferSig = await transfer(
    solanaConnection,
    OTHER_USER_KP,
    otherUserAta,
    userAta,
    OTHER_USER_KP,
    doubleAmount
  );
  console.log("SPL transfer OTHER_USER -> USER sig", transferSig);
});
