/**
 * A vault-resident account that a wallet has been authorized to use.
 *
 * `authToken` identifies the seed authorization granted to this app;
 * `derivationPath` picks the specific derived account; `publicKey` is the
 * resolved base58 Solana address.
 */
export type VaultAccount = {
  authToken: number;
  derivationPath: string;
  /** Base58-encoded public key (Solana address). */
  publicKey: string;
};

/**
 * Default Solana derivation path: `m/44'/501'/0'/0'`.
 * Matches Phantom and Solflare; the Seed Vault pre-derives this path at
 * authorization time, so public-key lookups do not require extra prompts.
 */
export const DEFAULT_SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";
