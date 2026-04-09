"use client";

import type { AuthSessionUser } from "@loyal-labs/auth-core";
import {
  type AnalyticsClient,
  type AnalyticsProperties,
  createMixpanelBrowserClient,
  createWorkspaceProfileUpdate,
} from "@loyal-labs/shared/analytics";

import type { PublicEnv } from "@/lib/core/config/public";

import {
  type FrontendAnalyticsEventName,
  getFrontendPageViewEventName,
} from "./events";

let analyticsClient: AnalyticsClient | null = null;
let analyticsClientKey: string | null = null;
let lastIdentifiedDistinctId: string | null = null;
let lastProfiledDistinctId: string | null = null;
let lastProfileFingerprint: string | null = null;
const WEBSITE_WORKSPACE = "website" as const;

function getCurrentPathname(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.location.pathname;
}

function withPath(properties?: AnalyticsProperties): AnalyticsProperties {
  const path = getCurrentPathname();

  if (!path) {
    return properties ?? {};
  }

  return {
    path,
    ...(properties ?? {}),
  };
}

function getApiHost(publicEnv: PublicEnv): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return `${window.location.origin}${publicEnv.mixpanelProxyPath}`;
}

function getClientKey(publicEnv: PublicEnv): string {
  return JSON.stringify({
    token: publicEnv.mixpanelToken ?? null,
    proxyPath: publicEnv.mixpanelProxyPath,
    appEnvironment: publicEnv.appEnvironment,
    solanaEnv: publicEnv.solanaEnv,
    gitBranch: publicEnv.gitBranch,
    gitCommitHash: publicEnv.gitCommitHash,
  });
}

function getAnalyticsClient(publicEnv: PublicEnv): AnalyticsClient {
  const nextClientKey = getClientKey(publicEnv);

  if (analyticsClient && analyticsClientKey === nextClientKey) {
    return analyticsClient;
  }

  analyticsClientKey = nextClientKey;
  analyticsClient = createMixpanelBrowserClient({
    token: publicEnv.mixpanelToken,
    apiHost: getApiHost(publicEnv),
    debug: publicEnv.appEnvironment !== "prod",
    persistence: "localStorage",
    defaultEventProperties: {
      workspace: WEBSITE_WORKSPACE,
    },
    registerProperties: {
      app_environment: publicEnv.appEnvironment,
      app_solana_env: publicEnv.solanaEnv,
      git_branch: publicEnv.gitBranch,
      git_commit_hash: publicEnv.gitCommitHash,
      workspace: WEBSITE_WORKSPACE,
    },
  });

  return analyticsClient;
}

function buildFrontendProfileProperties(user: AuthSessionUser): AnalyticsProperties {
  const profileProperties: AnalyticsProperties = {
    auth_method: user.authMethod,
  };

  if (user.provider) {
    profileProperties.provider = user.provider;
  }
  if (user.displayAddress) {
    profileProperties.display_address = user.displayAddress;
  }
  if (user.walletAddress) {
    profileProperties.wallet_address = user.walletAddress;
  }
  if (user.smartAccountAddress) {
    profileProperties.smart_account_address = user.smartAccountAddress;
  }
  if (user.settingsPda) {
    profileProperties.settings_pda = user.settingsPda;
  }

  return profileProperties;
}

function buildFrontendProfileFingerprint(user: AuthSessionUser): string {
  return JSON.stringify({
    authMethod: user.authMethod,
    provider: user.provider ?? null,
    displayAddress: user.displayAddress ?? null,
    walletAddress: user.walletAddress ?? null,
    smartAccountAddress: user.smartAccountAddress ?? null,
    settingsPda: user.settingsPda ?? null,
  });
}

function getWalletDistinctId(user: AuthSessionUser): string | null {
  if (!user.walletAddress) {
    return null;
  }

  return `wallet:${user.walletAddress}`;
}

export function initAnalytics(publicEnv: PublicEnv): Promise<void> {
  return getAnalyticsClient(publicEnv).init();
}

export function track(
  publicEnv: PublicEnv,
  event: string,
  properties?: AnalyticsProperties
): void {
  getAnalyticsClient(publicEnv).track(event, withPath(properties));
}

export function trackFrontendAnalyticsEvent(
  publicEnv: PublicEnv,
  event: FrontendAnalyticsEventName,
  properties?: AnalyticsProperties
): void {
  track(publicEnv, event, properties);
}

export function trackPageView(publicEnv: PublicEnv, pathname: string): void {
  track(publicEnv, getFrontendPageViewEventName(pathname), { path: pathname });
}

export function identifyAuthenticatedUser(
  publicEnv: PublicEnv,
  user: AuthSessionUser | null
): void {
  if (!user) {
    return;
  }

  const distinctId = getWalletDistinctId(user);
  if (!distinctId) {
    return;
  }

  const client = getAnalyticsClient(publicEnv);
  const profileFingerprint = buildFrontendProfileFingerprint(user);
  const shouldRefreshWorkspaceProfile = lastIdentifiedDistinctId !== distinctId;

  if (shouldRefreshWorkspaceProfile) {
    client.identify(distinctId);
    lastIdentifiedDistinctId = distinctId;
  }

  if (
    lastProfiledDistinctId !== distinctId ||
    lastProfileFingerprint !== profileFingerprint
  ) {
    client.setUserProfile(buildFrontendProfileProperties(user));
    lastProfiledDistinctId = distinctId;
    lastProfileFingerprint = profileFingerprint;
  }

  if (shouldRefreshWorkspaceProfile) {
    const workspaceProfileUpdate =
      createWorkspaceProfileUpdate(WEBSITE_WORKSPACE);
    client.unionUserProfile(workspaceProfileUpdate.union);
    client.setUserProfileOnce(workspaceProfileUpdate.setOnce);
    client.setUserProfile(workspaceProfileUpdate.set);
  }
}

export function resetAuthenticatedUser(): void {
  analyticsClient?.reset();
  lastIdentifiedDistinctId = null;
  lastProfiledDistinctId = null;
  lastProfileFingerprint = null;
}

export function __resetAnalyticsStateForTests(): void {
  analyticsClient?.__resetForTests();
  analyticsClient = null;
  analyticsClientKey = null;
  lastIdentifiedDistinctId = null;
  lastProfiledDistinctId = null;
  lastProfileFingerprint = null;
}
