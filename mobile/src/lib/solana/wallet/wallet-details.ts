import { AnchorProvider } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import type { Signer } from "@/lib/wallet/signer";

import { getConnection, getWebsocketConnection } from "../rpc/connection";
import { SimpleWallet } from "./wallet-implementation";

// Lazy-loaded to avoid top-level Buffer usage in React Native runtime
async function getSplToken() {
  return await import("@solana/spl-token");
}

let cachedWalletSigner: Signer | null = null;

export const setWalletSigner = (signer: Signer) => {
  cachedWalletSigner = signer;
};

export const clearWalletSignerCache = () => {
  cachedWalletSigner = null;
};

export const getWalletSigner = async (): Promise<Signer> => {
  if (cachedWalletSigner) return cachedWalletSigner;
  throw new Error("Wallet signer not set. Unlock the wallet first.");
};

export const getWalletProvider = async (): Promise<AnchorProvider> => {
  const signer = await getWalletSigner();
  const connection = getConnection();
  const wallet = new SimpleWallet(signer);

  return new AnchorProvider(connection, wallet);
};

export const getCustomWalletProvider = async (
  signer: Signer,
): Promise<AnchorProvider> => {
  const connection = getWebsocketConnection();
  const wallet = new SimpleWallet(signer);
  return new AnchorProvider(connection, wallet);
};

export const getWalletPublicKey = async (): Promise<PublicKey> => {
  const signer = await getWalletSigner();
  return signer.publicKey;
};

type CachedBalance = {
  lamports: number;
  fetchedAt: number;
};

const BALANCE_CACHE_TTL_MS = 10_000;
const BALANCE_RETRY_DELAYS_MS = [300, 900, 2_000] as const;
const RETRYABLE_BALANCE_ERROR_PATTERNS = [
  "429",
  "502",
  "503",
  "504",
  "timeout",
  "timed out",
  "network request failed",
  "fetch failed",
  "connection",
];

let balanceCache: CachedBalance | null = null;
let balancePromise: Promise<number> | null = null;

const shouldUseCachedBalance = (forceRefresh: boolean): boolean => {
  if (forceRefresh) return false;
  if (!balanceCache) return false;

  const age = Date.now() - balanceCache.fetchedAt;
  return age < BALANCE_CACHE_TTL_MS;
};

const setCachedBalance = (lamports: number) => {
  balanceCache = { lamports, fetchedAt: Date.now() };
};

const isRetryableBalanceError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return RETRYABLE_BALANCE_ERROR_PATTERNS.some((pattern) =>
    message.includes(pattern),
  );
};

const waitMs = (delayMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });

export const getWalletBalance = async (
  forceRefresh = false
): Promise<number> => {
  if (shouldUseCachedBalance(forceRefresh)) {
    return balanceCache!.lamports;
  }

  if (!forceRefresh && balancePromise) {
    return balancePromise;
  }

  const loader = (async () => {
    const connection = getConnection();
    const signer = await getWalletSigner();
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= BALANCE_RETRY_DELAYS_MS.length; attempt++) {
      try {
        const lamports = await connection.getBalance(
          signer.publicKey,
          "confirmed"
        );
        setCachedBalance(lamports);
        return lamports;
      } catch (error) {
        lastError = error;
        const retryDelayMs = BALANCE_RETRY_DELAYS_MS[attempt];
        if (
          typeof retryDelayMs !== "number" ||
          !isRetryableBalanceError(error)
        ) {
          throw error;
        }
        await waitMs(retryDelayMs);
      }
    }

    throw (
      lastError ?? new Error("Failed to fetch wallet balance after retries")
    );
  })();

  balancePromise = loader;

  try {
    return await loader;
  } finally {
    if (balancePromise === loader) {
      balancePromise = null;
    }
  }
};

const invalidateBalanceCache = () => {
  balanceCache = null;
  balancePromise = null;
};

export const subscribeToWalletBalance = async (
  onChange: (lamports: number) => void
): Promise<() => Promise<void>> => {
  const connection = getWebsocketConnection();
  const signer = await getWalletSigner();

  let lastLamports = balanceCache?.lamports;

  const subscriptionId = connection.onAccountChange(
    signer.publicKey,
    (accountInfo) => {
      const lamports = accountInfo.lamports;
      if (typeof lastLamports === "number" && lamports === lastLamports) {
        return;
      }

      lastLamports = lamports;
      setCachedBalance(lamports);
      onChange(lamports);
    },
    "confirmed"
  );

  return async () => {
    try {
      await connection.removeAccountChangeListener(subscriptionId);
    } catch (error) {
      console.error("Failed to remove balance subscription", error);
    }
  };
};

export const sendSolTransaction = async (
  destination: string | PublicKey,
  lamports: number
): Promise<string> => {
  if (lamports <= 0) {
    throw new Error("Lamports must be greater than zero");
  }

  const connection = getConnection();
  const signer = await getWalletSigner();
  const toPubkey =
    typeof destination === "string" ? new PublicKey(destination) : destination;

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey,
      lamports,
    })
  );

  transaction.feePayer = signer.publicKey;

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = latestBlockhash.blockhash;
  transaction.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;

  await signer.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
    { skipPreflight: false },
  );

  console.log("Transaction sent:", signature);

  const result = await connection.confirmTransaction(
    {
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      signature,
    },
    "confirmed"
  );

  console.log("Transaction confirmed:", result);

  invalidateBalanceCache();

  return signature;
};

export const sendSplTokenTransaction = async (
  destination: string | PublicKey,
  tokenMint: string | PublicKey,
  rawAmount: bigint,
  decimals: number
): Promise<string> => {
  if (rawAmount <= 0n) {
    throw new Error("Token amount must be greater than zero");
  }
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error("Token decimals must be a non-negative integer");
  }

  const connection = getConnection();
  const signer = await getWalletSigner();
  const toPubkey =
    typeof destination === "string" ? new PublicKey(destination) : destination;
  const mintPubkey =
    typeof tokenMint === "string" ? new PublicKey(tokenMint) : tokenMint;
  const {
    TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    createTransferCheckedInstruction,
    getAssociatedTokenAddressSync,
  } = await getSplToken();

  const owner = signer.publicKey;
  const senderAta = getAssociatedTokenAddressSync(
    mintPubkey,
    owner,
    false,
    TOKEN_PROGRAM_ID,
  );
  const recipientAta = getAssociatedTokenAddressSync(
    mintPubkey,
    toPubkey,
    false,
    TOKEN_PROGRAM_ID,
  );

  const transaction = new Transaction();
  const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
  if (!recipientAtaInfo) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        owner,
        recipientAta,
        toPubkey,
        mintPubkey,
        TOKEN_PROGRAM_ID,
      ),
    );
  }

  transaction.add(
    createTransferCheckedInstruction(
      senderAta,
      mintPubkey,
      recipientAta,
      owner,
      rawAmount,
      decimals,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

  transaction.feePayer = owner;

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = latestBlockhash.blockhash;
  transaction.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;

  await signer.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
    { skipPreflight: false },
  );

  console.log("Token transaction sent:", signature);

  const result = await connection.confirmTransaction(
    {
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      signature,
    },
    "confirmed"
  );

  console.log("Token transaction confirmed:", result);

  invalidateBalanceCache();

  return signature;
};
