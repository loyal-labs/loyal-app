import {
  DELEGATION_PROGRAM_ID,
  findDepositPda,
  findUsernameDepositPda,
  getErValidatorForSolanaEnv,
  LoyalPrivateTransactionsClient,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@loyal-labs/private-transactions";
import type { LoyalPrivateTransactionsClient as LoyalPrivateTransactionsClientType } from "@loyal-labs/private-transactions";
import type { Connection, Keypair } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

import {
  getConnection,
  getEndpoints,
  getPerEndpoints,
  getSolanaEnv,
} from "../rpc/connection";
import { closeWsolAta, wrapSolToWSol } from "../wsol-adapter";
import { getWalletKeypair } from "./wallet-details";

type TweetNaclModule = typeof import("tweetnacl");
type TweetNaclInteropModule = TweetNaclModule & {
  default?: Partial<TweetNaclModule> & {
    sign?: {
      detached?: (message: Uint8Array, secretKey: Uint8Array) => Uint8Array;
    };
  };
};

type PerAuthToken = {
  token: string;
  expiresAt: number;
};

let cachedClient: LoyalPrivateTransactionsClientType | null = null;
let cachedClientOwner: string | null = null;
let cachedAuthToken: PerAuthToken | null = null;

function resolveTweetNaclModule(
  module: TweetNaclInteropModule,
): {
  sign: {
    detached: (message: Uint8Array, secretKey: Uint8Array) => Uint8Array;
  };
} {
  const direct = module as unknown as {
    sign?: {
      detached?: (message: Uint8Array, secretKey: Uint8Array) => Uint8Array;
    };
  };
  if (typeof direct.sign?.detached === "function") {
    return { sign: { detached: direct.sign.detached } };
  }

  if (typeof module.default?.sign?.detached === "function") {
    return { sign: { detached: module.default.sign.detached } };
  }

  throw new Error("tweetnacl sign.detached is unavailable");
}

function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const base = 58n;
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }

  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % base);
    encoded = alphabet[remainder] + encoded;
    value /= base;
  }

  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }

  return encoded || "1";
}

async function getTweetNacl() {
  return resolveTweetNaclModule(await import("tweetnacl"));
}

async function getSplToken() {
  return await import("@solana/spl-token");
}

async function waitForAccount(
  connection: Connection,
  pda: PublicKey,
  maxAttempts = 30,
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const info = await connection.getAccountInfo(pda);
    if (info) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function getPerAuthToken(
  keypair: Keypair,
  perRpcEndpoint: string,
): Promise<PerAuthToken> {
  if (cachedAuthToken && cachedAuthToken.expiresAt > Date.now() + 60_000) {
    return cachedAuthToken;
  }

  const walletAddress = keypair.publicKey.toBase58();
  const challengeUrl = `${perRpcEndpoint}/auth/challenge?pubkey=${walletAddress}`;
  const challengeResponse = await fetch(challengeUrl);
  const challengeData = (await challengeResponse.json()) as {
    challenge?: unknown;
    error?: unknown;
  };

  if (!challengeResponse.ok) {
    const reason =
      typeof challengeData.error === "string" && challengeData.error
        ? challengeData.error
        : `status ${challengeResponse.status}`;
    throw new Error(`PER auth challenge failed: ${reason}`);
  }

  if (typeof challengeData.challenge !== "string" || !challengeData.challenge) {
    throw new Error("PER auth challenge is missing");
  }

  const { sign } = await getTweetNacl();
  const challengeBytes = new TextEncoder().encode(challengeData.challenge);
  const signature = sign.detached(challengeBytes, keypair.secretKey);
  const signatureBase58 = encodeBase58(signature);

  const loginResponse = await fetch(`${perRpcEndpoint}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pubkey: walletAddress,
      challenge: challengeData.challenge,
      signature: signatureBase58,
    }),
  });
  const loginData = (await loginResponse.json()) as {
    token?: unknown;
    expiresAt?: unknown;
    error?: unknown;
  };

  if (!loginResponse.ok || typeof loginData.token !== "string" || !loginData.token) {
    const reason =
      typeof loginData.error === "string" && loginData.error
        ? loginData.error
        : `status ${loginResponse.status}`;
    throw new Error(`PER auth login failed: ${reason}`);
  }

  const token = {
    token: loginData.token,
    expiresAt:
      typeof loginData.expiresAt === "number"
        ? loginData.expiresAt
        : Date.now() + 30 * 24 * 60 * 60 * 1_000,
  };
  cachedAuthToken = token;
  return token;
}

async function getPrivateTransactionsClient(
  keypair: Keypair,
): Promise<LoyalPrivateTransactionsClientType> {
  const walletAddress = keypair.publicKey.toBase58();
  if (cachedClient && cachedClientOwner === walletAddress) {
    return cachedClient;
  }

  cachedClient = null;
  cachedAuthToken = null;
  cachedClientOwner = walletAddress;

  const solanaEnv = getSolanaEnv();
  const { rpcEndpoint, websocketEndpoint } = getEndpoints(solanaEnv);
  const { perRpcEndpoint, perWsEndpoint } = getPerEndpoints(solanaEnv);
  const authToken =
    perRpcEndpoint.includes("tee")
      ? await getPerAuthToken(keypair, perRpcEndpoint)
      : undefined;

  const client = await LoyalPrivateTransactionsClient.fromConfig({
    signer: keypair,
    baseRpcEndpoint: rpcEndpoint,
    baseWsEndpoint: websocketEndpoint,
    ephemeralRpcEndpoint: perRpcEndpoint,
    ephemeralWsEndpoint: perWsEndpoint,
    authToken,
  });

  cachedClient = client;
  return client;
}

export async function sendPrivateTransferToTelegramUsername(params: {
  username: string;
  tokenMint: string;
  amount: number;
  decimals: number;
}): Promise<string> {
  // Force fresh PER auth/client for each username transfer to avoid stale token/session issues.
  cachedClient = null;
  cachedClientOwner = null;
  cachedAuthToken = null;

  const trimmedUsername = params.username.trim();
  if (!trimmedUsername) {
    throw new Error("Recipient username is required.");
  }

  const normalizedUsername = trimmedUsername.replace(/^@/, "").toLowerCase();
  if (!normalizedUsername) {
    throw new Error("Recipient username is invalid.");
  }

  const rawAmount = Math.floor(params.amount * 10 ** params.decimals);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    throw new Error("Enter a valid amount.");
  }

  const keypair = await getWalletKeypair();
  const user = keypair.publicKey;
  const connection = getConnection();
  const client = await getPrivateTransactionsClient(keypair);
  const tokenMint = new PublicKey(params.tokenMint);
  const validator = getErValidatorForSolanaEnv(getSolanaEnv());
  const { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } =
    await getSplToken();

  const requiredAmount = BigInt(rawAmount);
  const existingDeposit = await client.getEphemeralDeposit(user, tokenMint);
  const existingBalance = existingDeposit?.amount ?? BigInt(0);
  const requiresShield = existingBalance < requiredAmount;
  const isNativeSol = tokenMint.equals(NATIVE_MINT);

  console.log("[sendPrivate] v2 enter", {
    username: normalizedUsername,
    requiresShield,
    existingBalance: existingBalance.toString(),
    requiredAmount: requiredAmount.toString(),
  });

  if (requiresShield) {
    const [depositPda] = findDepositPda(user, tokenMint);
    const depositAccountInfo = await connection.getAccountInfo(depositPda);
    console.log("[sendPrivate] depositAccountInfo", {
      pda: depositPda.toBase58(),
      exists: !!depositAccountInfo,
      owner: depositAccountInfo?.owner.toBase58(),
      isDelegationProgram:
        depositAccountInfo?.owner.equals(DELEGATION_PROGRAM_ID) ?? false,
    });

    if (!depositAccountInfo) {
      console.log("[sendPrivate] initializing deposit");
      await client.initializeDeposit({
        tokenMint,
        user,
        payer: user,
      });
      await waitForAccount(connection, depositPda);
    } else if (depositAccountInfo.owner.equals(DELEGATION_PROGRAM_ID)) {
      console.log("[sendPrivate] undelegating deposit via SDK");
      await client.undelegateDeposit({
        tokenMint,
        user,
        payer: user,
        magicProgram: MAGIC_PROGRAM_ID,
        magicContext: MAGIC_CONTEXT_ID,
      });
      console.log("[sendPrivate] undelegate complete");
    }

    let createdAta = false;
    if (isNativeSol) {
      const result = await wrapSolToWSol({
        connection,
        keypair,
        lamports: rawAmount,
      });
      createdAta = result.createdAta;
    }

    const userTokenAccount = getAssociatedTokenAddressSync(
      tokenMint,
      user,
      false,
      TOKEN_PROGRAM_ID,
    );

    await client.modifyBalance({
      tokenMint,
      amount: rawAmount,
      increase: true,
      user,
      payer: user,
      userTokenAccount,
    });

    if (isNativeSol && createdAta) {
      await closeWsolAta({
        connection,
        keypair,
        wsolAta: userTokenAccount,
      });
    }

    try {
      await client.createPermission({
        tokenMint,
        user,
        payer: user,
      });
    } catch {
      // Permission may already exist.
    }

    try {
      await client.delegateDeposit({
        tokenMint,
        user,
        payer: user,
        validator,
      });
    } catch {
      // Deposit may already be delegated.
    }
  }

  const [usernameDepositPda] = await findUsernameDepositPda(
    normalizedUsername,
    tokenMint,
  );
  const usernameDepositInfo = await connection.getAccountInfo(usernameDepositPda);
  console.log("[sendPrivate] usernameDepositInfo", {
    pda: usernameDepositPda.toBase58(),
    exists: !!usernameDepositInfo,
    owner: usernameDepositInfo?.owner.toBase58(),
    isDelegationProgram:
      usernameDepositInfo?.owner.equals(DELEGATION_PROGRAM_ID) ?? false,
  });

  if (!usernameDepositInfo) {
    console.log("[sendPrivate] initializing username deposit");
    await client.initializeUsernameDeposit({
      tokenMint,
      username: normalizedUsername,
      payer: user,
    });
    await waitForAccount(connection, usernameDepositPda);
    console.log("[sendPrivate] delegating username deposit after init");
    await client.delegateUsernameDeposit({
      tokenMint,
      username: normalizedUsername,
      payer: user,
      validator,
    });
  } else if (!usernameDepositInfo.owner.equals(DELEGATION_PROGRAM_ID)) {
    console.log("[sendPrivate] delegating existing username deposit");
    await client.delegateUsernameDeposit({
      tokenMint,
      username: normalizedUsername,
      payer: user,
      validator,
    });
  }

  const transferSignature = await client.transferToUsernameDeposit({
    username: normalizedUsername,
    user,
    tokenMint,
    amount: rawAmount,
    payer: user,
  });

  return transferSignature;
}
