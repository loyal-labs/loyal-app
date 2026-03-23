"use client";

import type { AuthSessionUser } from "@loyal-labs/auth-core";
import type { AnalyticsProperties } from "@loyal-labs/shared/analytics";

import type { PublicEnv } from "@/lib/core/config/public";

export {
  identifyAuthenticatedUser,
  initAnalytics,
  resetAuthenticatedUser,
  track,
  trackFrontendAnalyticsEvent,
  trackPageView,
  __resetAnalyticsStateForTests,
} from "./analytics/client";
export {
  FRONTEND_ANALYTICS_EVENTS,
  getFrontendPageViewEventName,
  type AuthSignInPressedSource,
  type FrontendAnalyticsEventName,
  type OutboundLinkSource,
  type WalletSidebarOpenSource,
} from "./analytics/events";
export {
  getTrackedFrontendLink,
  openTrackedLink,
  trackFrontendLinkClick,
  type FrontendTrackedLink,
} from "./analytics/links";

import {
  type AuthSignInPressedSource,
  FRONTEND_ANALYTICS_EVENTS,
  type FrontendAnalyticsEventName,
  type WalletSidebarOpenSource,
  type WalletSidebarTab,
} from "./analytics/events";
import { trackFrontendAnalyticsEvent } from "./analytics/client";

export function trackAuthSignInPressed(
  publicEnv: PublicEnv,
  source: AuthSignInPressedSource
): void {
  trackFrontendAnalyticsEvent(publicEnv, FRONTEND_ANALYTICS_EVENTS.authSignInPressed, {
    source,
  });
}

export function trackAuthSignInSucceeded(
  publicEnv: PublicEnv,
  user: AuthSessionUser
): void {
  trackFrontendAnalyticsEvent(
    publicEnv,
    FRONTEND_ANALYTICS_EVENTS.authSignInSucceeded,
    {
      auth_method: user.authMethod,
      ...(user.provider ? { provider: user.provider } : {}),
      ...(user.gridUserId ? { grid_user_id: user.gridUserId } : {}),
      ...(user.walletAddress ? { wallet_address: user.walletAddress } : {}),
      ...(user.smartAccountAddress
        ? { smart_account_address: user.smartAccountAddress }
        : {}),
    }
  );
}

export function trackAuthLogout(
  publicEnv: PublicEnv,
  user: AuthSessionUser | null
): void {
  trackFrontendAnalyticsEvent(publicEnv, FRONTEND_ANALYTICS_EVENTS.authLogout, {
    ...(user?.authMethod ? { auth_method: user.authMethod } : {}),
    ...(user?.provider ? { provider: user.provider } : {}),
    ...(user?.gridUserId ? { grid_user_id: user.gridUserId } : {}),
    ...(user?.walletAddress ? { wallet_address: user.walletAddress } : {}),
  });
}

export function trackChatThreadCreated(
  publicEnv: PublicEnv,
  properties: AnalyticsProperties
): void {
  trackFrontendAnalyticsEvent(
    publicEnv,
    FRONTEND_ANALYTICS_EVENTS.chatThreadCreated,
    properties
  );
}

export function trackWalletSidebarTabOpen(
  publicEnv: PublicEnv,
  args: {
    source: WalletSidebarOpenSource;
    tab: WalletSidebarTab;
  }
): void {
  const eventByTab: Record<WalletSidebarTab, FrontendAnalyticsEventName> = {
    portfolio: FRONTEND_ANALYTICS_EVENTS.walletPortfolioOpened,
    receive: FRONTEND_ANALYTICS_EVENTS.walletReceivePressed,
    send: FRONTEND_ANALYTICS_EVENTS.walletSendPressed,
    swap: FRONTEND_ANALYTICS_EVENTS.walletSwapPressed,
  };

  trackFrontendAnalyticsEvent(publicEnv, eventByTab[args.tab], {
    source: args.source,
    interaction: "open",
    tab: args.tab,
  });
}

export function trackWalletSendPressed(
  publicEnv: PublicEnv,
  properties?: AnalyticsProperties
): void {
  trackFrontendAnalyticsEvent(
    publicEnv,
    FRONTEND_ANALYTICS_EVENTS.walletSendPressed,
    properties
  );
}

export function trackWalletSendCompleted(
  publicEnv: PublicEnv,
  properties: AnalyticsProperties
): void {
  trackFrontendAnalyticsEvent(
    publicEnv,
    FRONTEND_ANALYTICS_EVENTS.walletSendCompleted,
    properties
  );
}

export function trackWalletSwapPressed(
  publicEnv: PublicEnv,
  properties?: AnalyticsProperties
): void {
  trackFrontendAnalyticsEvent(
    publicEnv,
    FRONTEND_ANALYTICS_EVENTS.walletSwapPressed,
    properties
  );
}

export function trackWalletSwapCompleted(
  publicEnv: PublicEnv,
  properties: AnalyticsProperties
): void {
  trackFrontendAnalyticsEvent(
    publicEnv,
    FRONTEND_ANALYTICS_EVENTS.walletSwapCompleted,
    properties
  );
}

export function trackWalletShieldPressed(
  publicEnv: PublicEnv,
  properties?: AnalyticsProperties
): void {
  trackFrontendAnalyticsEvent(
    publicEnv,
    FRONTEND_ANALYTICS_EVENTS.walletShieldPressed,
    properties
  );
}

export function trackWalletShieldCompleted(
  publicEnv: PublicEnv,
  properties: AnalyticsProperties
): void {
  trackFrontendAnalyticsEvent(
    publicEnv,
    FRONTEND_ANALYTICS_EVENTS.walletShieldCompleted,
    properties
  );
}
