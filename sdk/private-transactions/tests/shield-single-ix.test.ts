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

// HsESHNax1HxTuPjK7Qj6vgSi9J9cKehadhpP9Vn7T9kh
const USER_KP = Keypair.fromSecretKey(
  Uint8Array.from([
    222, 231, 132, 233, 125, 235, 94, 127, 101, 114, 132, 38, 116, 188, 221,
    102, 81, 233, 111, 249, 190, 220, 27, 130, 139, 242, 157, 205, 236, 81, 143,
    42, 250, 153, 57, 42, 6, 39, 90, 118, 176, 200, 194, 167, 113, 182, 5, 247,
    75, 1, 240, 167, 107, 201, 93, 83, 107, 167, 134, 145, 145, 208, 165, 150,
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

const getConnection = () => solanaConnection;
const getWalletKeypair = async () => USER_KP;
const getLoyalClient = async () => loyalClient;
const getOtherLoyalClient = async () => otherLoyalClient;

describe("private-transactions shield SDK (PER)", async () => {
  console.log("wallet", USER.toString());
  const mint: PublicKey = NATIVE_MINT;
  console.log("mint", mint.toString());

  const amount = BigInt(LAMPORTS_PER_SOL) / 10n;

  const shieldSig = await loyalClient.shieldTokens({
    user: USER_KP,
    payer: USER_KP,
    tokenMint: mint,
    amount,
  });
  console.log("shieldSig", shieldSig);
});
