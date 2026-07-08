import { requireNativeModule } from "expo-modules-core";

/**
 * Native bridge — base64 over the wire for byte payloads (portable across
 * Expo Modules versions without depending on typed-array support).
 *
 * Auth tokens are Kotlin Longs. Current binaries pass them as decimal
 * strings (advertised via the `stringAuthTokens` constant); binaries built
 * before that constant expect JS numbers, which silently corrupt values
 * above 2^53. `index.ts` feature-detects and picks the right wire format.
 *
 * Shape returned from {@link NativeVaultAccount}:
 *   - authToken: decimal string on current binaries, number on legacy ones
 *   - publicKey: base64-encoded 32-byte Ed25519 public key
 */
export type NativeVaultAccount = {
  authToken: string | number;
  derivationPath: string;
  /** Base64 (no wrap) — 32 raw bytes of the Ed25519 public key. */
  publicKey: string;
};

/** Wire format for auth tokens; see the module doc comment. */
type NativeAuthToken = string | number;

type NativeModule = {
  /** True on binaries whose bridge passes auth tokens as decimal strings. */
  stringAuthTokens?: boolean;
  isAvailable(): Promise<boolean>;
  /**
   * Prompt the OS for the dangerous-level Seed Vault permission. Resolves to
   * true if the app already holds it or the user granted it; false on denial.
   */
  requestPermission(): Promise<boolean>;
  authorizeExistingSeed(derivationPath: string): Promise<NativeVaultAccount>;
  /**
   * Returns previously authorized seeds for this app (auth tokens the vault
   * still remembers). Used to recover orphaned authorizations across app
   * reinstalls or after a failed authorize flow.
   */
  listAuthorizedSeeds(
    derivationPath: string,
  ): Promise<NativeVaultAccount[]>;
  createNewSeed(derivationPath: string): Promise<NativeVaultAccount>;
  importSeed(derivationPath: string): Promise<NativeVaultAccount>;
  deauthorize(authToken: NativeAuthToken): Promise<void>;
  /** Returns base64 (no wrap) signature bytes. */
  signTransaction(
    authToken: NativeAuthToken,
    derivationPath: string,
    txBase64: string,
  ): Promise<string>;
  /**
   * Signs a batch of transactions in ONE vault authorization (single user
   * prompt). Returns base64 (no wrap) signature bytes, one per transaction,
   * in input order.
   */
  signTransactions(
    authToken: NativeAuthToken,
    derivationPath: string,
    txsBase64: string[],
  ): Promise<string[]>;
  /** Returns base64 (no wrap) signature bytes. */
  signMessage(
    authToken: NativeAuthToken,
    derivationPath: string,
    messageBase64: string,
  ): Promise<string>;
  /** Returns base64 (no wrap) 32-byte public key. */
  getPublicKey(
    authToken: NativeAuthToken,
    derivationPath: string,
  ): Promise<string>;
};

export default requireNativeModule<NativeModule>("ExpoSeedVault");
