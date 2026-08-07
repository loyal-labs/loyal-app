"use client";

import type MixpanelType from "mixpanel-browser";
import type { Persistence } from "mixpanel-browser";

import {
  type AnalyticsProfileUnionProperties,
  type AnalyticsProperties,
} from "./analytics-core";

export {
  createWorkspaceProfileUpdate,
  type AnalyticsPrimitive,
  type AnalyticsProfileProperties,
  type AnalyticsProfileUnionProperties,
  type AnalyticsProperties,
  type AnalyticsWorkspace,
  type AnalyticsWorkspaceProfileUpdate,
  withWorkspaceProperties,
} from "./analytics-core";

export type AnalyticsConfig = {
  token?: string;
  apiHost?: string;
  debug?: boolean;
  persistence?: Persistence;
  defaultEventProperties?: AnalyticsProperties;
  registerProperties?: AnalyticsProperties;
  flags?: boolean;
};

export type AnalyticsFlagVariant = {
  key: string;
  value: unknown;
};

export type AnalyticsClient = {
  init: () => Promise<void>;
  track: (event: string, properties?: AnalyticsProperties) => void;
  identify: (distinctId: string) => void;
  reset: () => void;
  setContext: (properties: AnalyticsProperties) => void;
  clearContext: () => void;
  setUserProfile: (properties: AnalyticsProperties) => void;
  setUserProfileOnce: (properties: AnalyticsProperties) => void;
  unionUserProfile: (properties: AnalyticsProfileUnionProperties) => void;
  getFlagVariant: (
    flagKey: string,
    fallbackValue: unknown
  ) => Promise<AnalyticsFlagVariant>;
  __resetForTests: () => void;
};

function isClientEnvironment(): boolean {
  return typeof window !== "undefined";
}

export function createMixpanelBrowserClient(
  config: AnalyticsConfig
): AnalyticsClient {
  let mixpanel: typeof MixpanelType | null = null;
  let isInitialized = false;
  let initPromise: Promise<void> | null = null;
  let currentEventContext: AnalyticsProperties = {};

  function canTrack(): boolean {
    return isClientEnvironment() && Boolean(config.token);
  }

  async function loadMixpanel(): Promise<typeof MixpanelType | null> {
    if (mixpanel) {
      return mixpanel;
    }

    try {
      const mod = await import("mixpanel-browser");
      mixpanel = mod.default;
      return mixpanel;
    } catch (error) {
      console.error("Failed to load Mixpanel", error);
      return null;
    }
  }

  async function init(): Promise<void> {
    if (!canTrack() || isInitialized) {
      return;
    }

    if (initPromise) {
      return initPromise;
    }

    initPromise = (async () => {
      const mp = await loadMixpanel();
      if (!mp) {
        initPromise = null;
        return;
      }

      if (!config.token) {
        return;
      }

      try {
        mp.init(config.token, {
          api_host: config.apiHost,
          debug: config.debug ?? false,
          track_pageview: false,
          persistence: config.persistence,
          flags: config.flags ?? false,
        });

        if (config.registerProperties) {
          mp.register(config.registerProperties);
        }

        isInitialized = true;
      } catch (error) {
        console.error("Failed to initialize Mixpanel", error);
        initPromise = null;
      }
    })();

    return initPromise;
  }

  function setContext(properties: AnalyticsProperties): void {
    currentEventContext = {
      ...properties,
    };
  }

  function clearContext(): void {
    currentEventContext = {};
  }

  function track(event: string, properties?: AnalyticsProperties): void {
    if (!canTrack()) {
      return;
    }

    void init().then(() => {
      if (!isInitialized || !mixpanel) {
        return;
      }

      try {
        mixpanel.track(event, {
          ...(config.defaultEventProperties ?? {}),
          ...currentEventContext,
          ...(properties ?? {}),
        });
      } catch (error) {
        console.error("Failed to track Mixpanel event", error);
      }
    });
  }

  function identify(distinctId: string): void {
    if (!canTrack()) {
      return;
    }

    void init().then(() => {
      if (!isInitialized || !mixpanel) {
        return;
      }

      try {
        mixpanel.identify(distinctId);
      } catch (error) {
        console.error("Failed to identify Mixpanel user", error);
      }
    });
  }

  function reset(): void {
    if (!canTrack()) {
      return;
    }

    void init().then(() => {
      if (!isInitialized || !mixpanel) {
        return;
      }

      try {
        mixpanel.reset();
      } catch (error) {
        console.error("Failed to reset Mixpanel user", error);
      }
    });
  }

  function setUserProfile(properties: AnalyticsProperties): void {
    if (!canTrack()) {
      return;
    }

    void init().then(() => {
      if (!isInitialized || !mixpanel) {
        return;
      }

      try {
        mixpanel.people.set(properties);
      } catch (error) {
        console.error("Failed to set Mixpanel profile", error);
      }
    });
  }

  function setUserProfileOnce(properties: AnalyticsProperties): void {
    if (!canTrack()) {
      return;
    }

    void init().then(() => {
      if (!isInitialized || !mixpanel) {
        return;
      }

      try {
        mixpanel.people.set_once(properties);
      } catch (error) {
        console.error("Failed to set Mixpanel profile once", error);
      }
    });
  }

  function unionUserProfile(properties: AnalyticsProfileUnionProperties): void {
    if (!canTrack()) {
      return;
    }

    void init().then(() => {
      if (!isInitialized || !mixpanel) {
        return;
      }

      try {
        mixpanel.people.union(properties);
      } catch (error) {
        console.error("Failed to union Mixpanel profile", error);
      }
    });
  }

  async function getFlagVariant(
    flagKey: string,
    fallbackValue: unknown
  ): Promise<AnalyticsFlagVariant> {
    const fallback: AnalyticsFlagVariant = {
      key: "fallback",
      value: fallbackValue,
    };

    if (!canTrack()) {
      return fallback;
    }

    try {
      await init();
      if (!isInitialized || !mixpanel) {
        return fallback;
      }

      const variant = await mixpanel.flags.get_variant(flagKey, fallback);
      return { key: variant.key, value: variant.value };
    } catch (error) {
      console.error("Failed to get Mixpanel flag variant", error);
      return fallback;
    }
  }

  function resetForTests(): void {
    mixpanel = null;
    isInitialized = false;
    initPromise = null;
    currentEventContext = {};
  }

  return {
    init,
    track,
    identify,
    reset,
    setContext,
    clearContext,
    setUserProfile,
    setUserProfileOnce,
    unionUserProfile,
    getFlagVariant,
    __resetForTests: resetForTests,
  };
}
