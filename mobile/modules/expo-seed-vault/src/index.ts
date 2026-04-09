import { Platform } from "react-native";

import ExpoSeedVault, { type NativeVaultAccount } from "./ExpoSeedVault";
import { DEFAULT_SOLANA_DERIVATION_PATH, type VaultAccount } from "./types";

export { DEFAULT_SOLANA_DERIVATION_PATH } from "./types";
export type { VaultAccount } from "./types";

// ---------------------------------------------------------------------------
// Encoding helpers (module-local, no runtime deps).
// ---------------------------------------------------------------------------

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return globalThis.btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = globalThis.atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }
  let encoded = "";
  const base = 58n;
  while (value > 0n) {
    const remainder = Number(value % base);
    encoded = BASE58_ALPHABET[remainder] + encoded;
    value /= base;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded || "1";
}

function toVaultAccount(native: NativeVaultAccount): VaultAccount {
  return {
    authToken: native.authToken,
    derivationPath: native.derivationPath,
    publicKey: encodeBase58(base64ToUint8(native.publicKey)),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Is a Seed Vault implementation available on this device?
 *
 * Returns `false` on iOS and on Android devices without the Seed Vault
 * package installed. Safe to call at UI render time.
 */
export async function isAvailable(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    return await ExpoSeedVault.isAvailable();
  } catch {
    return false;
  }
}

/**
 * Prompt the user to authorize an existing seed already stored in the vault.
 * The vault's picker UI appears; on success we get back an auth token and
 * the public key for the requested derivation path.
 */
export async function authorizeExistingSeed(
  derivationPath: string = DEFAULT_SOLANA_DERIVATION_PATH,
): Promise<VaultAccount> {
  const native = await ExpoSeedVault.authorizeExistingSeed(derivationPath);
  return toVaultAccount(native);
}

/**
 * Prompt the user to generate a new seed inside the vault and authorize it
 * for this app. The fresh 24-word seed never leaves the vault.
 */
export async function createNewSeed(
  derivationPath: string = DEFAULT_SOLANA_DERIVATION_PATH,
): Promise<VaultAccount> {
  const native = await ExpoSeedVault.createNewSeed(derivationPath);
  return toVaultAccount(native);
}

/**
 * Prompt the user to import an existing BIP-39 mnemonic into the vault and
 * authorize it for this app.
 */
export async function importSeed(
  derivationPath: string = DEFAULT_SOLANA_DERIVATION_PATH,
): Promise<VaultAccount> {
  const native = await ExpoSeedVault.importSeed(derivationPath);
  return toVaultAccount(native);
}

/**
 * Release this app's authorization for the given seed. The seed itself stays
 * in the vault and can be re-authorized later.
 */
export async function deauthorize(authToken: number): Promise<void> {
  await ExpoSeedVault.deauthorize(authToken);
}

/**
 * Ask the vault to sign a transaction. The vault prompts the user for
 * biometric/PIN confirmation before returning the signature bytes.
 */
export async function signTransaction(args: {
  authToken: number;
  derivationPath: string;
  txBytes: Uint8Array;
}): Promise<Uint8Array> {
  const sigB64 = await ExpoSeedVault.signTransaction(
    args.authToken,
    args.derivationPath,
    uint8ToBase64(args.txBytes),
  );
  return base64ToUint8(sigB64);
}

/**
 * Ask the vault to sign an arbitrary message (used for auth challenges, not
 * for transactions). The vault prompts the user.
 */
export async function signMessage(args: {
  authToken: number;
  derivationPath: string;
  message: Uint8Array;
}): Promise<Uint8Array> {
  const sigB64 = await ExpoSeedVault.signMessage(
    args.authToken,
    args.derivationPath,
    uint8ToBase64(args.message),
  );
  return base64ToUint8(sigB64);
}

/**
 * Look up the public key for an already-authorized derivation path without
 * prompting the user. Only works for paths the vault has pre-derived at
 * authorization time (the Solana defaults are pre-derived).
 */
export async function getPublicKey(args: {
  authToken: number;
  derivationPath: string;
}): Promise<string> {
  const b64 = await ExpoSeedVault.getPublicKey(
    args.authToken,
    args.derivationPath,
  );
  return encodeBase58(base64ToUint8(b64));
}

// Exposed for tests.
export const __test__ = { encodeBase58, uint8ToBase64, base64ToUint8 };
