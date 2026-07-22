import { env } from "@/config/env";

import { earnHeaders, type EarnAuthFields } from "./earn-api";

// Mobile Earn session (ASK-1846): a backend-minted bearer token that lets the
// DB-only Autodeposit calls (execute-now, threshold, pause/resume) skip the
// per-request wallet-signed auth message — i.e. skip the Seed Vault/MWA
// approval prompt the signature costs. Minted opportunistically from auth
// messages the user is already signing for real Earn flows (signEarnAuth), so
// obtaining it never costs a prompt of its own. Web parity: these actions ride
// a session cookie there.

const STORAGE_KEY = "earn.session.v1";
// Don't present a token that's about to expire mid-flow.
const EXPIRY_SAFETY_MS = 5 * 60 * 1000;

type StoredEarnSession = {
  walletAddress: string;
  token: string;
  expiresAt: string;
};

// undefined = SecureStore not read yet this launch.
let cached: StoredEarnSession | null | undefined;
let mintInFlight: Promise<void> | null = null;

// Lazy-loaded so the native module never loads at module top-level (mirrors
// the tweetnacl pattern in wallet/signer.ts; also keeps jest imports inert).
async function secureStore() {
  return await import("expo-secure-store");
}

async function loadStored(): Promise<StoredEarnSession | null> {
  if (cached !== undefined) {
    return cached;
  }
  try {
    const raw = await (await secureStore()).getItemAsync(STORAGE_KEY);
    cached = raw ? (JSON.parse(raw) as StoredEarnSession) : null;
  } catch {
    cached = null;
  }
  return cached;
}

function isUsable(
  session: StoredEarnSession,
  walletAddress: string,
): boolean {
  const expiresAtMs = Date.parse(session.expiresAt);
  return (
    session.walletAddress === walletAddress &&
    Number.isFinite(expiresAtMs) &&
    expiresAtMs - EXPIRY_SAFETY_MS > Date.now()
  );
}

// The cached token for this wallet, or null when a signed auth message (and a
// wallet prompt) is needed. A stale token for a different wallet is ignored —
// it gets overwritten by that wallet's next opportunistic mint.
export async function getEarnSessionToken(
  walletAddress: string,
): Promise<string | null> {
  const stored = await loadStored();
  return stored && isUsable(stored, walletAddress) ? stored.token : null;
}

// Drop the cached token (server rejected it, or hygiene).
export async function clearEarnSession(): Promise<void> {
  cached = null;
  try {
    await (await secureStore()).deleteItemAsync(STORAGE_KEY);
  } catch {
    // Nothing usable remains cached either way.
  }
}

// Trade an already-signed auth message for a session token, in the background.
// Never throws and never prompts; a failed mint just means the next DB-only
// action falls back to a signed message (the status quo).
export function maybeMintEarnSession(auth: EarnAuthFields): void {
  if (mintInFlight) {
    return;
  }
  mintInFlight = (async () => {
    try {
      if (await getEarnSessionToken(auth.walletAddress)) {
        return;
      }
      const res = await fetch(
        `${env.earnApiBaseUrl}/api/smart-accounts/mobile/earn/session`,
        {
          method: "POST",
          headers: earnHeaders(),
          body: JSON.stringify({ ...auth }),
        },
      );
      if (!res.ok) {
        return;
      }
      const payload = (await res.json()) as {
        token?: string;
        expiresAt?: string;
      };
      if (!payload.token || !payload.expiresAt) {
        return;
      }
      cached = {
        expiresAt: payload.expiresAt,
        token: payload.token,
        walletAddress: auth.walletAddress,
      };
      await (
        await secureStore()
      ).setItemAsync(STORAGE_KEY, JSON.stringify(cached));
    } catch {
      // Best-effort by design.
    } finally {
      mintInFlight = null;
    }
  })();
}
