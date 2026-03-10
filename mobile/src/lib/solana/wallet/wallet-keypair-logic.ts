import { Keypair } from "@solana/web3.js";
import * as SecureStore from "expo-secure-store";

import {
  PUBLIC_KEY_STORAGE_KEY,
  SECRET_KEY_STORAGE_KEY,
} from "../constants";

export type WalletKeypairResult = { keypair: Keypair; isNew: boolean };

type StoredKeypairStrings = {
  publicKey: string;
  secretKey: string;
};

const PERSIST_RETRY_ATTEMPTS = 3;
const PERSIST_RETRY_DELAY_MS = 120;

const serializeSecretKey = (secretKey: Uint8Array): string =>
  JSON.stringify(Array.from(secretKey));

const deserializeSecretKey = (storedSecretKey: string): Uint8Array | null => {
  try {
    const parsed = JSON.parse(storedSecretKey);
    if (!Array.isArray(parsed)) return null;

    const numbers = parsed.every(
      (value: unknown) => typeof value === "number" && Number.isInteger(value)
    );

    if (!numbers) return null;

    return Uint8Array.from(parsed);
  } catch (error) {
    console.error("Failed to parse stored secret key", error);
    return null;
  }
};

const fetchStoredKeypairStrings = async (): Promise<
  StoredKeypairStrings | "not_found"
> => {
  const [publicKey, secretKey] = await Promise.all([
    SecureStore.getItemAsync(PUBLIC_KEY_STORAGE_KEY),
    SecureStore.getItemAsync(SECRET_KEY_STORAGE_KEY),
  ]);

  // null = keys don't exist (new user)
  if (!publicKey || !secretKey) return "not_found";

  return { publicKey, secretKey };
};

const persistKeypair = async (keypair: Keypair): Promise<boolean> => {
  const publicKey = keypair.publicKey.toBase58();
  const secretKey = serializeSecretKey(keypair.secretKey);

  try {
    await SecureStore.setItemAsync(PUBLIC_KEY_STORAGE_KEY, publicKey);
  } catch {
    return false;
  }

  try {
    await SecureStore.setItemAsync(SECRET_KEY_STORAGE_KEY, secretKey);
  } catch {
    await SecureStore.deleteItemAsync(PUBLIC_KEY_STORAGE_KEY);
    return false;
  }

  return true;
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const persistKeypairWithRetry = async (keypair: Keypair): Promise<boolean> => {
  for (let attempt = 1; attempt <= PERSIST_RETRY_ATTEMPTS; attempt += 1) {
    const persisted = await persistKeypair(keypair);
    if (persisted) {
      return true;
    }

    if (attempt < PERSIST_RETRY_ATTEMPTS) {
      await wait(PERSIST_RETRY_DELAY_MS);
    }
  }

  return false;
};

const instantiateKeypair = (stored: StoredKeypairStrings): Keypair | null => {
  const secretKey = deserializeSecretKey(stored.secretKey);
  if (!secretKey) return null;

  try {
    const keypair = Keypair.fromSecretKey(secretKey);

    if (keypair.publicKey.toBase58() !== stored.publicKey) {
      console.error("Stored public key does not match secret key");
      return null;
    }

    return keypair;
  } catch (error) {
    console.error("Failed to instantiate keypair from secret key", error);
    return null;
  }
};

export const ensureWalletKeypair = async (): Promise<WalletKeypairResult> => {
  const storedResult = await fetchStoredKeypairStrings();

  if (storedResult !== "not_found") {
    const existing = instantiateKeypair(storedResult);
    if (existing) {
      return { keypair: existing, isNew: false };
    }
    // Keys exist but are corrupted — fall through to generate new
  }

  const generatedKeypair = Keypair.generate();

  const persisted = await persistKeypairWithRetry(generatedKeypair);

  if (!persisted) {
    throw new Error("Failed to persist generated wallet keypair");
  }

  return { keypair: generatedKeypair, isNew: true };
};
