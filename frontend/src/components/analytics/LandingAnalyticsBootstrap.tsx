"use client";

import type { AnalyticsProperties } from "@loyal-labs/shared/analytics";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { usePublicEnv } from "@/contexts/public-env-context";
import {
  FRONTEND_ANALYTICS_EVENTS,
  initAnalytics,
  trackFrontendAnalyticsEvent,
  trackPageView,
} from "@/lib/core/analytics";

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
  const lastTrackedPathRef = useRef<string | null>(null);

  useEffect(() => {
    void initAnalytics(publicEnv);
  }, [publicEnv]);

  useEffect(() => {
    if (!pathname || pathname === lastTrackedPathRef.current) {
      return;
    }

    lastTrackedPathRef.current = pathname;
    trackPageView(publicEnv, pathname);
  }, [pathname, publicEnv]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
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
  }, [pathname, publicEnv]);

  return null;
}
