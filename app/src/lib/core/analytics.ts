"use client";

import {
  type AnalyticsClient,
  type AnalyticsProperties,
  createMixpanelBrowserClient,
} from "@loyal-labs/shared/analytics";

import { publicEnv } from "@/lib/core/config/public";
import type {
  TelegramIdentity,
  TelegramLaunchContext,
} from "@/lib/telegram/mini-app/init-data-transform";
import { parseSummaryFeedStartParam } from "@/lib/telegram/mini-app/start-param";

let analyticsClient: AnalyticsClient | null = null;
let lastIdentifiedDistinctId: string | null = null;
let lastProfiledDistinctId: string | null = null;
let lastProfileFingerprint: string | null = null;

const TELEGRAM_IDENTITY_PROVIDER = "telegram" as const;

function normalizeOptionalString(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function getApiHost(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return `${window.location.origin}${publicEnv.mixpanelProxyPath}`;
}

function getAnalyticsClient(): AnalyticsClient {
  if (analyticsClient) {
    return analyticsClient;
  }

  const isDevnetDemoMode = publicEnv.solanaEnv === "devnet";

  analyticsClient = createMixpanelBrowserClient({
    token: publicEnv.mixpanelToken,
    apiHost: getApiHost(),
    debug: isDevnetDemoMode,
    persistence: "localStorage",
    registerProperties: isDevnetDemoMode
      ? {
          app_mode: "demo",
          app_solana_env: "devnet",
        }
      : undefined,
  });

  return analyticsClient;
}

function mapLaunchContextToEventProperties(
  context: TelegramLaunchContext
): AnalyticsProperties {
  const startParamRaw = normalizeOptionalString(context.startParamRaw) ?? "none";
  const parsedStartParam = parseSummaryFeedStartParam(context.startParamRaw);

  return {
    start_param_raw: startParamRaw,
    group_chat_id: parsedStartParam?.groupChatId ?? "none",
    summary_id: parsedStartParam?.summaryId ?? "none",
  };
}

function buildTelegramProfileProperties(
  identity: TelegramIdentity
): AnalyticsProperties {
  const username = normalizeOptionalString(identity.username);
  const profileProperties: AnalyticsProperties = {
    telegram_id: identity.telegramId,
    identity_provider: TELEGRAM_IDENTITY_PROVIDER,
  };

  if (username) {
    profileProperties.$username = username;
    profileProperties.telegram_username = username;
  }
  if (identity.firstName) {
    profileProperties.$first_name = identity.firstName;
  }
  if (identity.lastName) {
    profileProperties.$last_name = identity.lastName;
  }
  if (identity.photoUrl) {
    profileProperties.$avatar = identity.photoUrl;
  }
  if (identity.languageCode) {
    profileProperties.$language = identity.languageCode;
    profileProperties.telegram_language_code = identity.languageCode;
  }
  if (identity.isPremium !== undefined) {
    profileProperties.telegram_is_premium = identity.isPremium;
  }

  return profileProperties;
}

function buildTelegramProfileFingerprint(identity: TelegramIdentity): string {
  return JSON.stringify({
    telegramId: identity.telegramId,
    firstName: identity.firstName,
    lastName: identity.lastName ?? null,
    username: normalizeOptionalString(identity.username),
    photoUrl: identity.photoUrl ?? null,
    languageCode: identity.languageCode ?? null,
    isPremium: identity.isPremium ?? null,
  });
}

export function initAnalytics(): Promise<void> {
  return getAnalyticsClient().init();
}

export function setTelegramLaunchContext(
  context: TelegramLaunchContext | null
): void {
  getAnalyticsClient().setContext(mapLaunchContextToEventProperties(context ?? {}));
}

export function clearTelegramLaunchContext(): void {
  getAnalyticsClient().clearContext();
}

export function track(event: string, properties?: AnalyticsProperties): void {
  getAnalyticsClient().track(event, properties);
}

export function identifyTelegramUser(identity: TelegramIdentity | null): void {
  if (!identity) {
    return;
  }

  const client = getAnalyticsClient();
  const distinctId = `tg:${identity.telegramId}`;
  const profileFingerprint = buildTelegramProfileFingerprint(identity);

  if (lastIdentifiedDistinctId !== distinctId) {
    client.identify(distinctId);
    lastIdentifiedDistinctId = distinctId;
  }

  if (
    lastProfiledDistinctId !== distinctId ||
    lastProfileFingerprint !== profileFingerprint
  ) {
    client.setUserProfile(buildTelegramProfileProperties(identity));
    lastProfiledDistinctId = distinctId;
    lastProfileFingerprint = profileFingerprint;
  }
}

export function identify(distinctId: string): void {
  getAnalyticsClient().identify(distinctId);
}

export function resetAnalytics(): void {
  getAnalyticsClient().reset();
}

export function setUserProfile(properties: AnalyticsProperties): void {
  getAnalyticsClient().setUserProfile(properties);
}

export function __resetAnalyticsStateForTests(): void {
  analyticsClient?.__resetForTests();
  analyticsClient = null;
  lastIdentifiedDistinctId = null;
  lastProfiledDistinctId = null;
  lastProfileFingerprint = null;
}
