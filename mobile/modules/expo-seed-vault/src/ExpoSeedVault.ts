import { requireNativeModule } from "expo-modules-core";

/**
 * Native bridge — base64 over the wire for byte payloads (portable across
 * Expo Modules versions without depending on typed-array support).
 *
 * Shape returned from {@link NativeVaultAccount}:
 *   - authToken: numeric (note: JS number precision is fine for Seed Vault's
 *     long auth tokens because they stay well below 2^53)
 *   - publicKey: base64-encoded 32-byte Ed25519 public key
 */
export type NativeVaultAccount = {
  authToken: number;
  derivationPath: string;
  /** Base64 (no wrap) — 32 raw bytes of the Ed25519 public key. */
  publicKey: string;
};

type NativeModule = {
  isAvailable(): Promise<boolean>;
  authorizeExistingSeed(derivationPath: string): Promise<NativeVaultAccount>;
  createNewSeed(derivationPath: string): Promise<NativeVaultAccount>;
  importSeed(derivationPath: string): Promise<NativeVaultAccount>;
  deauthorize(authToken: number): Promise<void>;
  /** Returns base64 (no wrap) signature bytes. */
  signTransaction(
    authToken: number,
    derivationPath: string,
    txBase64: string,
  ): Promise<string>;
  /** Returns base64 (no wrap) signature bytes. */
  signMessage(
    authToken: number,
    derivationPath: string,
    messageBase64: string,
  ): Promise<string>;
  /** Returns base64 (no wrap) 32-byte public key. */
  getPublicKey(authToken: number, derivationPath: string): Promise<string>;
};

export default requireNativeModule<NativeModule>("ExpoSeedVault");
