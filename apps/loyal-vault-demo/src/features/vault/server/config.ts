/**
 * Server-side configuration for the vault read model.
 *
 * Server-only: never import this from a client component. It holds no signing
 * material. Identities are pinned; request handlers accept only the parameters
 * listed here, so a caller can never steer the app at a foreign vault, mint,
 * program or recipient.
 */

export { VAULT_IDENTITY, parseWalletParam } from "../domain/identity";
export type { ParsedWallet } from "../domain/identity";

export const RPC_BOUNDS = {
  timeoutMs: 30_000,
  maxAttempts: 3,
  commitment: "finalized" as const,
  /** Shared vault observation cache. */
  vaultCacheTtlMs: 5_000,
  positionCacheTtlMs: 2_000,
  maxStalenessMs: 15_000,
  /** After a failed observation, retry only after this bounded backoff. */
  failureBackoffMs: 5_000,
} as const;

export function rpcUrlFromEnv(): string {
  const url = process.env.LOYAL_VAULT_DEMO_RPC_URL;
  if (url && url.length > 0) return url;
  // Read-only public endpoint. No secret is required for the read model, and no
  // devnet/frontend credential is ever assumed to serve this mainnet demo.
  return "https://api.mainnet-beta.solana.com";
}

/** Rejects any request that carries parameters the read model never accepts. */
export function rejectForeignParams(params: URLSearchParams, allowed: readonly string[]): string | null {
  for (const key of [...params.keys()]) {
    if (!allowed.includes(key)) {
      return `unsupported parameter "${key}"; this endpoint accepts only ${allowed.join(", ")}`;
    }
  }
  return null;
}
