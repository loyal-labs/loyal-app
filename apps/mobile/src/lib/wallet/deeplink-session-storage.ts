import * as SecureStore from "expo-secure-store";

import type { DeeplinkWalletProvider } from "./deeplink-protocol";

const DEEPLINK_SESSION_KEY = "loyal.deeplinkWalletSession";

/**
 * Persistent record of a Phantom/Solflare deeplink authorization. The keys
 * stay inside the wallet app; we remember the opaque session token, the
 * resolved base58 Solana address, and the encryption material every follow-up
 * request needs: the x25519 shared secret derived during connect and the dapp
 * public key the wallet indexes it by. The dapp secret key is NOT kept — once
 * the shared secret exists it has no further use, so it dies with connect.
 */
export type StoredDeeplinkSession = {
  provider: DeeplinkWalletProvider;
  /** Base58-encoded Solana public key. */
  publicKey: string;
  /** Opaque wallet session token, sent with every request. */
  session: string;
  /** Base58 nacl.box shared secret for request/response encryption. */
  sharedSecret: string;
  /** Base58 dapp x25519 public key the wallet maps to the shared secret. */
  dappPublicKey: string;
};

function parseStoredDeeplinkSession(
  value: unknown,
): StoredDeeplinkSession | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    (v.provider !== "phantom" && v.provider !== "solflare") ||
    typeof v.publicKey !== "string" ||
    typeof v.session !== "string" ||
    typeof v.sharedSecret !== "string" ||
    typeof v.dappPublicKey !== "string"
  ) {
    return null;
  }
  return {
    provider: v.provider,
    publicKey: v.publicKey,
    session: v.session,
    sharedSecret: v.sharedSecret,
    dappPublicKey: v.dappPublicKey,
  };
}

export async function storeDeeplinkSession(
  session: StoredDeeplinkSession,
): Promise<void> {
  await SecureStore.setItemAsync(DEEPLINK_SESSION_KEY, JSON.stringify(session));
}

export async function loadDeeplinkSession(): Promise<StoredDeeplinkSession | null> {
  const raw = await SecureStore.getItemAsync(DEEPLINK_SESSION_KEY);
  if (!raw) return null;
  try {
    return parseStoredDeeplinkSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function clearDeeplinkSession(): Promise<void> {
  await SecureStore.deleteItemAsync(DEEPLINK_SESSION_KEY);
}
