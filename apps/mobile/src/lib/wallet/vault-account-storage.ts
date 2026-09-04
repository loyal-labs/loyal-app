import * as SecureStore from "expo-secure-store";

const VAULT_ACCOUNT_KEY = "loyal.seedVaultAccount";

/**
 * Persistent record of a Seed Vault authorization. The seed itself stays
 * inside the vault; we only need to remember the auth token, which
 * derivation path we authorized, and the resolved base58 Solana address
 * so the wallet can display it before any signing operation runs.
 *
 * `authToken` is a native Kotlin Long carried as a decimal string — a JS
 * number would corrupt values above 2^53.
 */
export type StoredVaultAccount = {
  authToken: string;
  derivationPath: string;
  /** Base58-encoded Solana public key. */
  publicKey: string;
};

function parseStoredVaultAccount(value: unknown): StoredVaultAccount | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.derivationPath !== "string" || typeof v.publicKey !== "string") {
    return null;
  }
  // Records written before the string-token migration hold a number.
  const authToken =
    typeof v.authToken === "string" && /^\d+$/.test(v.authToken)
      ? v.authToken
      : typeof v.authToken === "number" && Number.isFinite(v.authToken)
        ? String(v.authToken)
        : null;
  if (authToken === null) return null;
  return {
    authToken,
    derivationPath: v.derivationPath,
    publicKey: v.publicKey,
  };
}

export async function storeVaultAccount(
  account: StoredVaultAccount,
): Promise<void> {
  await SecureStore.setItemAsync(VAULT_ACCOUNT_KEY, JSON.stringify(account));
}

export async function loadVaultAccount(): Promise<StoredVaultAccount | null> {
  const raw = await SecureStore.getItemAsync(VAULT_ACCOUNT_KEY);
  if (!raw) return null;
  try {
    return parseStoredVaultAccount(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function clearVaultAccount(): Promise<void> {
  await SecureStore.deleteItemAsync(VAULT_ACCOUNT_KEY);
}

export async function hasVaultAccount(): Promise<boolean> {
  return (await SecureStore.getItemAsync(VAULT_ACCOUNT_KEY)) !== null;
}
