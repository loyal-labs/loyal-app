// Direct-HTTP Mixpanel client for the extension.
//
// The Chrome Web Store rejected a previous submission because the
// `mixpanel-browser` SDK ships minified/obfuscated code that gets bundled
// into the extension. This module replaces the SDK with direct calls to
// Mixpanel's `/track` and `/engage` HTTP endpoints, keeping analytics
// intact without any third-party bundle.

type AnalyticsPrimitive = boolean | null | number | string;
type AnalyticsProperties = Record<string, unknown>;
type AnalyticsListPrimitive = boolean | number | string;
type AnalyticsProfileUnionProperties = Record<string, AnalyticsListPrimitive[]>;

const MIXPANEL_TOKEN = import.meta.env.VITE_MIXPANEL_TOKEN as
  | string
  | undefined;
const MIXPANEL_API_HOST = "https://api-js.mixpanel.com";
const DISTINCT_ID_KEY = "mp_ext_distinct_id";

const registeredProperties: AnalyticsProperties = {
  platform: "extension",
};

let lastIdentifiedDistinctId: string | null = null;

function isBrowserEnv(): boolean {
  return typeof window !== "undefined";
}

function canTrack(): boolean {
  return isBrowserEnv() && Boolean(MIXPANEL_TOKEN);
}

function generateAnonymousId(): string {
  const cryptoObj =
    typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return `$device:${cryptoObj.randomUUID()}`;
  }
  // Fallback: random base36 string
  return `$device:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function readStoredDistinctId(): string | null {
  if (!isBrowserEnv()) return null;
  try {
    return window.localStorage.getItem(DISTINCT_ID_KEY);
  } catch {
    return null;
  }
}

function writeStoredDistinctId(id: string | null): void {
  if (!isBrowserEnv()) return;
  try {
    if (id === null) {
      window.localStorage.removeItem(DISTINCT_ID_KEY);
    } else {
      window.localStorage.setItem(DISTINCT_ID_KEY, id);
    }
  } catch {
    // Storage unavailable — analytics degrades to per-session identity.
  }
}

function getDistinctId(): string {
  const existing = readStoredDistinctId();
  if (existing) return existing;
  const fresh = generateAnonymousId();
  writeStoredDistinctId(fresh);
  return fresh;
}

function setDistinctId(id: string): void {
  writeStoredDistinctId(id);
}

function encodePayload(payload: unknown): string {
  const json = JSON.stringify(payload);
  // Use TextEncoder → base64 to preserve multibyte UTF-8 characters.
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function sendPayload(endpoint: "track" | "engage", payload: unknown): void {
  if (!canTrack()) return;
  try {
    const body = `data=${encodeURIComponent(encodePayload(payload))}&ip=1`;
    void fetch(`${MIXPANEL_API_HOST}/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/plain",
      },
      body,
      keepalive: true,
    }).catch((error) => {
      console.error(`Failed to POST Mixpanel ${endpoint}`, error);
    });
  } catch (error) {
    console.error(`Failed to encode Mixpanel ${endpoint} payload`, error);
  }
}

export function initAnalytics(): Promise<void> {
  if (!canTrack()) return Promise.resolve();
  // Ensure distinct_id exists so subsequent events are attributable.
  getDistinctId();
  return Promise.resolve();
}

export function track(event: string, properties?: AnalyticsProperties): void {
  if (!canTrack() || !MIXPANEL_TOKEN) return;

  const distinctId = getDistinctId();
  const timeSeconds = Math.floor(Date.now() / 1000);

  sendPayload("track", {
    event,
    properties: {
      token: MIXPANEL_TOKEN,
      distinct_id: distinctId,
      time: timeSeconds,
      $insert_id: generateAnonymousId().slice(8),
      ...registeredProperties,
      ...(properties ?? {}),
    },
  });
}

export function identifyWallet(
  publicKey: string,
  source: "created" | "imported"
): void {
  if (!canTrack()) return;
  const distinctId = `ext:${publicKey}`;
  if (lastIdentifiedDistinctId !== distinctId) {
    setDistinctId(distinctId);
    lastIdentifiedDistinctId = distinctId;
  }

  updateUserProfile({
    wallet_address: publicKey,
    wallet_source: source,
    identity_provider: "extension",
  });
}

export function updateUserProfile(properties: AnalyticsProperties): void {
  if (!canTrack() || !MIXPANEL_TOKEN) return;
  sendPayload("engage", {
    $token: MIXPANEL_TOKEN,
    $distinct_id: getDistinctId(),
    $set: properties,
  });
}

export function setUserProfileOnce(properties: AnalyticsProperties): void {
  if (!canTrack() || !MIXPANEL_TOKEN) return;
  sendPayload("engage", {
    $token: MIXPANEL_TOKEN,
    $distinct_id: getDistinctId(),
    $set_once: properties,
  });
}

export function unionUserProfile(
  properties: AnalyticsProfileUnionProperties
): void {
  if (!canTrack() || !MIXPANEL_TOKEN) return;
  sendPayload("engage", {
    $token: MIXPANEL_TOKEN,
    $distinct_id: getDistinctId(),
    $union: properties,
  });
}

export function resetAnalytics(): void {
  lastIdentifiedDistinctId = null;
  writeStoredDistinctId(null);
  if (canTrack()) {
    // Seed a fresh anonymous id so subsequent events still flow.
    getDistinctId();
  }
}

/**
 * Check if a fresh-install event is pending (set by background on
 * chrome.runtime.onInstalled) and fire it once from the UI context.
 */
export async function flushInstallEvent(): Promise<void> {
  const { installEventPending } = await import("~/src/lib/storage");
  const pending = await installEventPending.getValue();
  if (!pending) return;
  track("Installed Extension");
  await installEventPending.setValue(false);
}

export function getAnalyticsErrorProperties(error: unknown): {
  error_name: string;
  error_message: string;
} {
  if (error instanceof Error) {
    return {
      error_name: error.name || "Error",
      error_message: error.message || "Unknown error",
    };
  }

  return {
    error_name: "UnknownError",
    error_message: typeof error === "string" ? error : "Unknown error",
  };
}

export type { AnalyticsPrimitive, AnalyticsProperties };
