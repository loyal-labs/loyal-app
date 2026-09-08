import { env } from "@/config/env";

import { mintEarnSession, type EarnAuthFields } from "./earn-api";

// SecureStore only: bearer credentials must never enter MMKV or logs. Keep the
// shipped key so production OTA users retain their existing wallet approval.
// New records carry origin/cluster; unscoped legacy records are accepted only
// by the shipped production endpoint, never sent to preview/local servers.
const STORAGE_KEY = "earn.session.v1";
const EXPIRY_SAFETY_MS = 5 * 60 * 1000;
type StoredEarnSession = {
  walletAddress: string;
  token: string;
  expiresAt: string;
  apiBaseUrl?: string;
  cluster?: string;
};
let cached: StoredEarnSession | null | undefined;
let generation = 0;
const mints = new Map<string, Promise<void>>();
let storageWrites = Promise.resolve();
function persist(operation: () => Promise<void>): Promise<void> {
  const write = storageWrites.then(operation);
  storageWrites = write.catch(() => undefined);
  return write;
}

async function secureStore() {
  return await import("expo-secure-store");
}
async function loadStored(): Promise<StoredEarnSession | null> {
  if (cached !== undefined) return cached;
  const started = generation;
  try {
    const raw = await (await secureStore()).getItemAsync(STORAGE_KEY);
    if (started === generation && cached === undefined)
      cached = raw ? (JSON.parse(raw) as StoredEarnSession) : null;
  } catch {
    if (started === generation && cached === undefined) cached = null;
  }
  return cached ?? null;
}

export async function getEarnSessionToken(
  walletAddress: string
): Promise<string | null> {
  const stored = await loadStored();
  const scopeMatches = stored?.apiBaseUrl
    ? stored.apiBaseUrl === env.earnApiBaseUrl &&
      stored.cluster === env.solanaEnv
    : env.earnApiBaseUrl === "https://askloyal.com" &&
      env.solanaEnv === "mainnet";
  return scopeMatches &&
    stored?.walletAddress === walletAddress &&
    Date.parse(stored.expiresAt) - EXPIRY_SAFETY_MS > Date.now()
    ? stored.token
    : null;
}

// A late 401 must not erase a newer session minted by another request.
export async function clearEarnSession(rejectedToken?: string): Promise<void> {
  if (rejectedToken && (await loadStored())?.token !== rejectedToken) return;
  ++generation;
  cached = null;
  try {
    await persist(async () => {
      await (await secureStore()).deleteItemAsync(STORAGE_KEY);
    });
  } catch {
    /* No usable cached credential. */
  }
}

// Best-effort piggyback mint. Returning the shared promise also lets passive
// local-wallet bootstrap wait for it without a second signature or mint.
export function maybeMintEarnSession(auth: EarnAuthFields): Promise<void> {
  const existing = mints.get(auth.walletAddress);
  if (existing) return existing;
  const started = generation;
  const promise = (async () => {
    try {
      if (await getEarnSessionToken(auth.walletAddress)) return;
      const payload = await mintEarnSession(auth);
      if (started !== generation) return;
      const session = {
        ...payload,
        walletAddress: auth.walletAddress,
        apiBaseUrl: env.earnApiBaseUrl,
        cluster: env.solanaEnv,
      };
      cached = session;
      await persist(async () => {
        if (started !== generation || cached !== session) return;
        await (
          await secureStore()
        ).setItemAsync(STORAGE_KEY, JSON.stringify(session));
      });
    } catch {
      /* Passive auth failure stays retryable, never unhandled. */
    }
  })().finally(() => {
    if (mints.get(auth.walletAddress) === promise)
      mints.delete(auth.walletAddress);
  });
  mints.set(auth.walletAddress, promise);
  return promise;
}
