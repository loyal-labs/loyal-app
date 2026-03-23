"use client";

import type { AnalyticsProperties } from "@loyal-labs/shared/analytics";

import type { PublicEnv } from "@/lib/core/config/public";

import { trackFrontendAnalyticsEvent } from "./client";
import {
  DOCS_HOSTNAME,
  FRONTEND_ANALYTICS_EVENTS,
  type FrontendAnalyticsEventName,
  type OutboundLinkSource,
  TRACKED_DOWNLOAD_PATTERN,
} from "./events";

export type FrontendTrackedLink = {
  event: FrontendAnalyticsEventName;
  properties: AnalyticsProperties;
};

function getCurrentPathname(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.location.pathname;
}

function isTrackedDownload(url: URL): boolean {
  return TRACKED_DOWNLOAD_PATTERN.test(url.pathname);
}

export function getTrackedFrontendLink(args: {
  currentOrigin: string;
  href: string;
  linkText?: string | null;
  path?: string | null;
  source?: OutboundLinkSource | null;
}): FrontendTrackedLink | null {
  let resolvedUrl: URL;

  try {
    resolvedUrl = new URL(args.href, args.currentOrigin);
  } catch {
    return null;
  }

  const isSameOrigin = resolvedUrl.origin === args.currentOrigin;
  if (isSameOrigin && !isTrackedDownload(resolvedUrl)) {
    return null;
  }

  const event =
    resolvedUrl.hostname === DOCS_HOSTNAME
      ? FRONTEND_ANALYTICS_EVENTS.siteDocsOpened
      : FRONTEND_ANALYTICS_EVENTS.siteLinkOpened;

  return {
    event,
    properties: {
      url: resolvedUrl.toString(),
      hostname: resolvedUrl.hostname,
      link_text: args.linkText?.trim() || "unknown",
      source: args.source?.trim() || "link",
      path: args.path?.trim() || "/",
    },
  };
}

export function trackFrontendLinkClick(
  publicEnv: PublicEnv,
  args: {
    href: string;
    linkText?: string | null;
    source: OutboundLinkSource;
    path?: string | null;
  }
): void {
  if (typeof window === "undefined") {
    return;
  }

  const trackedLink = getTrackedFrontendLink({
    currentOrigin: window.location.origin,
    href: args.href,
    linkText: args.linkText,
    path: args.path ?? getCurrentPathname(),
    source: args.source,
  });

  if (!trackedLink) {
    return;
  }

  trackFrontendAnalyticsEvent(publicEnv, trackedLink.event, trackedLink.properties);
}

export function openTrackedLink(
  publicEnv: PublicEnv,
  args: {
    href: string;
    linkText?: string;
    source: OutboundLinkSource;
    target?: string;
    features?: string;
  }
): void {
  if (typeof window === "undefined") {
    return;
  }

  trackFrontendLinkClick(publicEnv, {
    href: args.href,
    linkText: args.linkText,
    source: args.source,
  });

  if (args.target === "_self") {
    window.location.assign(args.href);
    return;
  }

  window.open(
    args.href,
    args.target ?? "_blank",
    args.features ?? "noopener,noreferrer"
  );
}
