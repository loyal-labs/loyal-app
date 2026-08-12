import { Keypair } from "@solana/web3.js";

import { StoredKeypairStrings, WalletKeypairResult } from "@/types/solana";

import {
  PUBLIC_KEY_STORAGE_KEY,
  SECRET_KEY_STORAGE_KEY,
} from "../../constants";
import {
  deleteCloudValue,
  getCloudValue,
  setCloudValue,
} from "../../telegram/mini-app/cloud-storage";

export class CloudStorageUnavailableError extends Error {
  constructor(message = "Cloud storage is unavailable. Please try again.") {
    super(message);
    this.name = "CloudStorageUnavailableError";
  }
}

const PERSIST_RETRY_ATTEMPTS = 3;
const PERSIST_RETRY_DELAY_MS = 120;

const READ_RETRY_ATTEMPTS = 3;
const READ_RETRY_DELAY_MS = 200;

const serializeSecretKey = (secretKey: Uint8Array): string =>
  JSON.stringify(Array.from(secretKey));

const deserializeSecretKey = (storedSecretKey: string): Uint8Array | null => {
  try {
    const parsed = JSON.parse(storedSecretKey);
    if (!Array.isArray(parsed)) return null;

    const numbers = parsed.every(
      (value) => typeof value === "number" && Number.isInteger(value)
    );

    if (!numbers) return null;

    return Uint8Array.from(parsed);
  } catch (error) {
    console.error("Failed to parse stored secret key", error);
    return null;
  }
};

const fetchStoredKeypairStrings = async (): Promise<
  StoredKeypairStrings | "not_found" | "unavailable"
> => {
  // Fetch keys individually to avoid @telegram-apps/sdk ValiError when
  // some Telegram clients return a JSON string instead of a parsed Object
  // for multi-key getItem requests.
  const [publicKey, secretKey] = await Promise.all([
    getCloudValue(PUBLIC_KEY_STORAGE_KEY),
    getCloudValue(SECRET_KEY_STORAGE_KEY),
  ]);

  // null = cloud storage didn't respond properly
  if (publicKey === null || secretKey === null) return "unavailable";

  // Non-string = unexpected response shape
  if (typeof publicKey !== "string" || typeof secretKey !== "string")
    return "unavailable";

  // Empty strings = keys genuinely don't exist (new user)
  if (!publicKey || !secretKey) return "not_found";

  return { publicKey, secretKey };
};

const fetchStoredKeypairWithRetry = async (): Promise<
  StoredKeypairStrings | "not_found"
> => {
  for (let attempt = 1; attempt <= READ_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const result = await fetchStoredKeypairStrings();

      // Definitive answers — no need to retry
      if (result === "not_found") return "not_found";
      if (result !== "unavailable") return result;

      // "unavailable" — retry after delay
      if (attempt < READ_RETRY_ATTEMPTS) {
        await wait(READ_RETRY_DELAY_MS * attempt);
      }
    } catch {
      // getCloudValue threw — retry
      if (attempt < READ_RETRY_ATTEMPTS) {
        await wait(READ_RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw new CloudStorageUnavailableError();
};

const persistKeypair = async (keypair: Keypair): Promise<boolean> => {
  const publicKey = keypair.publicKey.toBase58();
  const secretKey = serializeSecretKey(keypair.secretKey);

  const storedPublic = await setCloudValue(PUBLIC_KEY_STORAGE_KEY, publicKey);
  if (!storedPublic) return false;

  const storedSecret = await setCloudValue(SECRET_KEY_STORAGE_KEY, secretKey);
  if (!storedSecret) {
    await deleteCloudValue(PUBLIC_KEY_STORAGE_KEY);
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
  const storedResult = await fetchStoredKeypairWithRetry();

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
