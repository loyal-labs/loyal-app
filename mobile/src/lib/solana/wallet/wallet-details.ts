import { AnchorProvider } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import { getConnection, getWebsocketConnection } from "../rpc/connection";
import { SimpleWallet } from "./wallet-implementation";
import { ensureWalletKeypair } from "./wallet-keypair-logic";

let cachedWalletKeypair: Keypair | null = null;
let walletKeypairPromise: Promise<Keypair> | null = null;

export const getWalletKeypair = async (): Promise<Keypair> => {
  if (cachedWalletKeypair) return cachedWalletKeypair;

  if (!walletKeypairPromise) {
    walletKeypairPromise = ensureWalletKeypair()
      .then(({ keypair }) => {
        cachedWalletKeypair = keypair;
        return keypair;
      })
      .finally(() => {
        walletKeypairPromise = null;
      });
  }

  return walletKeypairPromise;
};

export const getWalletProvider = async (): Promise<AnchorProvider> => {
  const keypair = await getWalletKeypair();
  const connection = getConnection();
  const wallet = new SimpleWallet(keypair);

  return new AnchorProvider(connection, wallet);
};

export const getCustomWalletProvider = async (
  keypair: Keypair
): Promise<AnchorProvider> => {
  const connection = getWebsocketConnection();
  const wallet = new SimpleWallet(keypair);
  return new AnchorProvider(connection, wallet);
};

export const getWalletPublicKey = async (): Promise<PublicKey> => {
  const keypair = await getWalletKeypair();
  return keypair.publicKey;
};

type CachedBalance = {
  lamports: number;
  fetchedAt: number;
};

const BALANCE_CACHE_TTL_MS = 10_000;

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
    const keypair = await getWalletKeypair();

    const lamports = await connection.getBalance(
      keypair.publicKey,
      "confirmed"
    );
    setCachedBalance(lamports);

    return lamports;
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
  const keypair = await getWalletKeypair();

  let lastLamports = balanceCache?.lamports;

  const subscriptionId = connection.onAccountChange(
    keypair.publicKey,
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
  const keypair = await getWalletKeypair();
  const toPubkey =
    typeof destination === "string" ? new PublicKey(destination) : destination;

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey,
      lamports,
    })
  );

  transaction.feePayer = keypair.publicKey;

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = latestBlockhash.blockhash;
  transaction.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;

  const signature = await connection.sendTransaction(transaction, [keypair], {
    skipPreflight: false,
  });

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

export const resetWalletKeypairCache = () => {
  cachedWalletKeypair = null;
  walletKeypairPromise = null;
};
