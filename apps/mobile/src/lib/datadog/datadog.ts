// Datadog RUM + Logs setup for the mobile app. Mirrors the web setup in
// `/app/src/lib/core/datadog.ts` but uses the native React Native SDK.
//
// Sourcemap upload is not yet wired — stack traces will reference minified
// bundle positions until we add a build-time upload via datadog-ci.

import {
  DatadogProviderConfiguration,
  DdSdkReactNative,
  SdkVerbosity,
  TrackingConsent,
} from "@datadog/mobile-react-native";
import * as Updates from "expo-updates";

const CLIENT_TOKEN = "pub65e82b493fbf5faa4c3847345e32e609";
const APPLICATION_ID = "b50251e5-df19-40f8-acc4-8e8e346d6e53";
const SITE = "US5";
const SERVICE = "mobile-app";

function getDatadogEnv(): string {
  // Updates.channel is set by EAS based on the build profile's `channel`.
  // Fallback to "dev" when running in the Expo dev client locally, where
  // Updates.channel is an empty string.
  const channel = Updates.channel ?? "";
  if (channel === "production") return "prod";
  if (channel === "preview") return "preview";
  if (channel === "dapp-store") return "prod";
  return "dev";
}

let initialized = false;
let initPromise: Promise<void> | null = null;

export function initDatadog(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (initPromise) return initPromise;

  const config = new DatadogProviderConfiguration(
    CLIENT_TOKEN,
    getDatadogEnv(),
    TrackingConsent.GRANTED,
    {
      site: SITE,
      service: SERVICE,
      version: Updates.runtimeVersion ?? undefined,
      verbosity: __DEV__ ? SdkVerbosity.WARN : undefined,
      rumConfiguration: {
        applicationId: APPLICATION_ID,
        trackInteractions: true,
        trackResources: true,
        trackErrors: true,
        trackFrustrations: true,
        nativeCrashReportEnabled: true,
        sessionSampleRate: 100,
      },
      logsConfiguration: {},
    },
  );

  initPromise = DdSdkReactNative.initialize(config)
    .then(() => {
      initialized = true;
    })
    .catch((error: unknown) => {
      console.warn("[datadog] init failed", error);
    })
    .finally(() => {
      initPromise = null;
    });

  return initPromise;
}

export type DatadogUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  extraInfo?: Record<string, unknown>;
};

export function identifyDatadogUser(user: DatadogUser): void {
  void DdSdkReactNative.setUserInfo({
    id: user.id,
    ...(user.name ? { name: user.name } : {}),
    ...(user.email ? { email: user.email } : {}),
    ...(user.extraInfo ? { extraInfo: user.extraInfo } : {}),
  }).catch((error: unknown) => {
    console.warn("[datadog] setUserInfo failed", error);
  });
}

export function clearDatadogUser(): void {
  void DdSdkReactNative.clearUserInfo().catch((error: unknown) => {
    console.warn("[datadog] clearUserInfo failed", error);
  });
}
