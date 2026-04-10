import {
  type AnalyticsClient,
  type AnalyticsProperties,
  createMixpanelBrowserClient,
} from "@loyal-labs/shared/analytics";

let analyticsClient: AnalyticsClient | null = null;
let lastIdentifiedDistinctId: string | null = null;

const MIXPANEL_TOKEN = import.meta.env.VITE_MIXPANEL_TOKEN as
  | string
  | undefined;

function getAnalyticsClient(): AnalyticsClient {
  if (analyticsClient) {
    return analyticsClient;
  }

  analyticsClient = createMixpanelBrowserClient({
    token: MIXPANEL_TOKEN,
    debug: import.meta.env.DEV,
    persistence: "localStorage",
    registerProperties: {
      platform: "extension",
    },
  });

  return analyticsClient;
}

export function initAnalytics(): Promise<void> {
  return getAnalyticsClient().init();
}

export function track(event: string, properties?: AnalyticsProperties): void {
  getAnalyticsClient().track(event, properties);
}

export function identifyWallet(
  publicKey: string,
  source: "created" | "imported"
): void {
  const client = getAnalyticsClient();
  const distinctId = `ext:${publicKey}`;

  if (lastIdentifiedDistinctId !== distinctId) {
    client.identify(distinctId);
    lastIdentifiedDistinctId = distinctId;
  }

  client.setUserProfile({
    wallet_address: publicKey,
    wallet_source: source,
    identity_provider: "extension",
  });
}

export function updateUserProfile(properties: AnalyticsProperties): void {
  getAnalyticsClient().setUserProfile(properties);
}

export function resetAnalytics(): void {
  getAnalyticsClient().reset();
  lastIdentifiedDistinctId = null;
}

/**
 * Check if a fresh-install event is pending (set by background on
 * chrome.runtime.onInstalled) and fire it once from the UI context
 * where the Mixpanel browser client is available.
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
