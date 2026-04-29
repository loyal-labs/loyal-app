"use client";

import type { AnalyticsProperties } from "@loyal-labs/shared/analytics";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import {
  FRONTEND_ANALYTICS_EVENTS,
  initAnalytics,
  trackFrontendAnalyticsEvent,
  trackPageView,
} from "@/lib/core/analytics";
import { LandingCookieConsent } from "./landing-cookie-consent";

export type LandingAnchorClickParams = {
  currentOrigin: string;
  currentPathname: string;
  href: string;
  linkText?: string | null;
};

export function getLandingAnchorClickProperties({
  currentOrigin,
  currentPathname,
  href,
  linkText,
}: LandingAnchorClickParams): AnalyticsProperties | null {
  let resolvedUrl: URL;

  try {
    resolvedUrl = new URL(href, `${currentOrigin}${currentPathname}`);
  } catch {
    return null;
  }

  if (resolvedUrl.origin !== currentOrigin || !resolvedUrl.hash) {
    return null;
  }

  return {
    anchor: resolvedUrl.hash,
    hostname: resolvedUrl.hostname,
    link_text: linkText?.trim() || "unknown",
    path: currentPathname,
    source: "anchor_link",
    url: resolvedUrl.toString(),
  };
}

function getClickedAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest<HTMLAnchorElement>("a[href^='#']");
}

export function LandingAnalyticsBootstrap() {
  const pathname = usePathname();
  const publicEnv = usePublicEnv();
  const [hasAnalyticsConsent, setHasAnalyticsConsent] = useState(false);
  const lastTrackedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasAnalyticsConsent) {
      return;
    }

    void initAnalytics(publicEnv);
  }, [hasAnalyticsConsent, publicEnv]);

  useEffect(() => {
    if (
      !hasAnalyticsConsent ||
      !pathname ||
      pathname === lastTrackedPathRef.current
    ) {
      return;
    }

    lastTrackedPathRef.current = pathname;
    trackPageView(publicEnv, pathname);
  }, [hasAnalyticsConsent, pathname, publicEnv]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!hasAnalyticsConsent) {
        return;
      }

      const anchor = getClickedAnchor(event.target);
      if (!anchor || !pathname) {
        return;
      }

      const properties = getLandingAnchorClickProperties({
        currentOrigin: window.location.origin,
        currentPathname: pathname,
        href: anchor.getAttribute("href") ?? "",
        linkText: anchor.textContent,
      });

      if (!properties) {
        return;
      }

      trackFrontendAnalyticsEvent(
        publicEnv,
        FRONTEND_ANALYTICS_EVENTS.siteLinkOpened,
        properties
      );
    };

    document.addEventListener("click", handleClick);

    return () => {
      document.removeEventListener("click", handleClick);
    };
  }, [hasAnalyticsConsent, pathname, publicEnv]);

  const handleAnalyticsConsentChange = useCallback((hasConsent: boolean) => {
    setHasAnalyticsConsent(hasConsent);
  }, []);

  return (
    <LandingCookieConsent
      onAnalyticsConsentChange={handleAnalyticsConsentChange}
      publicEnv={publicEnv}
    />
  );
}
