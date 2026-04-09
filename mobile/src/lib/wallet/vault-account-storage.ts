import * as SecureStore from "expo-secure-store";

const VAULT_ACCOUNT_KEY = "loyal.seedVaultAccount";

/**
 * Persistent record of a Seed Vault authorization. The seed itself stays
 * inside the vault; we only need to remember the auth token, which
 * derivation path we authorized, and the resolved base58 Solana address
 * so the wallet can display it before any signing operation runs.
 */
export type StoredVaultAccount = {
  authToken: number;
  derivationPath: string;
  /** Base58-encoded Solana public key. */
  publicKey: string;
};

function isStoredVaultAccount(value: unknown): value is StoredVaultAccount {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.authToken === "number" &&
    Number.isFinite(v.authToken) &&
    typeof v.derivationPath === "string" &&
    typeof v.publicKey === "string"
  );
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
    const parsed = JSON.parse(raw);
    return isStoredVaultAccount(parsed) ? parsed : null;
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
