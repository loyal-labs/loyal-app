// Mixpanel client for the mobile app.
//
// Unlike the extension (which ships a hand-rolled HTTP client to avoid
// Chrome Web Store obfuscation-rejection), mobile uses the official
// mixpanel-react-native SDK. The public surface mirrors the extension's
// `src/lib/analytics.ts` so call sites look identical across targets.

import { Mixpanel } from "mixpanel-react-native";

import { env } from "@/config/env";
import { clearDatadogUser, identifyDatadogUser } from "@/lib/datadog/datadog";

type AnalyticsPrimitive = boolean | null | number | string;
type AnalyticsProperties = Record<string, unknown>;
type AnalyticsListPrimitive = boolean | number | string;
type AnalyticsProfileUnionProperties = Record<string, AnalyticsListPrimitive[]>;

const WORKSPACE = "mobile";

const registeredProperties: AnalyticsProperties = {
  workspace: WORKSPACE,
};

let client: Mixpanel | null = null;
let initPromise: Promise<Mixpanel | null> | null = null;
let lastIdentifiedDistinctId: string | null = null;

function canTrack(): boolean {
  return Boolean(env.mixpanelToken);
}

async function getClient(): Promise<Mixpanel | null> {
  if (!canTrack()) return null;
  if (client) return client;
  if (initPromise) return initPromise;

  const trackAutomaticEvents = false;
  initPromise = (async () => {
    try {
      const instance = new Mixpanel(env.mixpanelToken, trackAutomaticEvents);
      await instance.init();
      instance.registerSuperProperties(registeredProperties);
      client = instance;
      return instance;
    } catch (error) {
      console.warn("[analytics] Mixpanel init failed", error);
      return null;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

export async function initAnalytics(): Promise<void> {
  await getClient();
}

export function getWorkspaceEventName(event: string): string {
  const prefix = `[${WORKSPACE}] `;
  return event.startsWith(prefix) ? event : `${prefix}${event}`;
}

export function track(event: string, properties?: AnalyticsProperties): void {
  if (!canTrack()) return;
  void (async () => {
    const c = await getClient();
    if (!c) return;
    try {
      c.track(getWorkspaceEventName(event), properties);
    } catch (error) {
      console.warn("[analytics] track failed", event, error);
    }
  })();
}

export function identifyWallet(
  publicKey: string,
  source: "created" | "imported" | "vault",
): void {
  const distinctId = `mob:${publicKey}`;
  identifyDatadogUser({
    id: distinctId,
    extraInfo: {
      wallet_address: publicKey,
      wallet_source: source,
      workspace: WORKSPACE,
    },
  });
  if (!canTrack()) return;
  void (async () => {
    const c = await getClient();
    if (!c) return;
    try {
      if (lastIdentifiedDistinctId !== distinctId) {
        await c.identify(distinctId);
        lastIdentifiedDistinctId = distinctId;
      }
      c.getPeople().set({
        wallet_address: publicKey,
        wallet_source: source,
        identity_provider: WORKSPACE,
        last_workspace: WORKSPACE,
      });
    } catch (error) {
      console.warn("[analytics] identify failed", error);
    }
  })();
}

export function updateUserProfile(properties: AnalyticsProperties): void {
  if (!canTrack()) return;
  void (async () => {
    const c = await getClient();
    if (!c) return;
    try {
      c.getPeople().set(properties);
    } catch (error) {
      console.warn("[analytics] updateUserProfile failed", error);
    }
  })();
}

export function setUserProfileOnce(properties: AnalyticsProperties): void {
  if (!canTrack()) return;
  void (async () => {
    const c = await getClient();
    if (!c) return;
    try {
      c.getPeople().setOnce(properties);
    } catch (error) {
      console.warn("[analytics] setUserProfileOnce failed", error);
    }
  })();
}

export function unionUserProfile(
  properties: AnalyticsProfileUnionProperties,
): void {
  if (!canTrack()) return;
  void (async () => {
    const c = await getClient();
    if (!c) return;
    try {
      for (const [key, values] of Object.entries(properties)) {
        c.getPeople().union(key, values);
      }
    } catch (error) {
      console.warn("[analytics] unionUserProfile failed", error);
    }
  })();
}

export function resetAnalytics(): void {
  lastIdentifiedDistinctId = null;
  clearDatadogUser();
  if (!canTrack()) return;
  void (async () => {
    const c = await getClient();
    if (!c) return;
    try {
      await c.reset();
    } catch (error) {
      console.warn("[analytics] reset failed", error);
    }
  })();
}

export type { AnalyticsPrimitive, AnalyticsProperties };
