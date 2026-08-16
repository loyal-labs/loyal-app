import * as SecureStore from "expo-secure-store";

const MWA_ACCOUNT_KEY = "loyal.mwaAccount";

/**
 * Persistent record of a Mobile Wallet Adapter authorization. The keys stay
 * inside the user's wallet app (Phantom, Solflare, Seed Vault Wallet, …); we
 * only remember the auth token for silent reauthorization and the resolved
 * base58 Solana address so the wallet can display it before any signing
 * operation runs.
 */
export type StoredMwaAccount = {
  authToken: string;
  /** Base58-encoded Solana public key. */
  publicKey: string;
  /** Wallet-provided display label, e.g. "Phantom". */
  label?: string;
};

function parseStoredMwaAccount(value: unknown): StoredMwaAccount | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.authToken !== "string" || typeof v.publicKey !== "string") {
    return null;
  }
  return {
    authToken: v.authToken,
    publicKey: v.publicKey,
    label: typeof v.label === "string" ? v.label : undefined,
  };
}

export async function storeMwaAccount(
  account: StoredMwaAccount,
): Promise<void> {
  await SecureStore.setItemAsync(MWA_ACCOUNT_KEY, JSON.stringify(account));
}

export async function loadMwaAccount(): Promise<StoredMwaAccount | null> {
  const raw = await SecureStore.getItemAsync(MWA_ACCOUNT_KEY);
  if (!raw) return null;
  try {
    return parseStoredMwaAccount(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function clearMwaAccount(): Promise<void> {
  await SecureStore.deleteItemAsync(MWA_ACCOUNT_KEY);
}
