"use client";

import { retrieveLaunchParams } from "@telegram-apps/sdk-react";

import {
  parseSummaryFeedStartParam,
  parseVerifyStartParam,
} from "@/lib/telegram/mini-app/start-param";

/**
 * Extract start_param from the native Telegram WebApp bridge object.
 * This is set by Telegram before the web app loads and is the most
 * reliable source — it doesn't depend on URL hash format or SDK init.
 */
function getNativeStartParam(): string | undefined {
  try {
    const startParam = (
      window as {
        Telegram?: { WebApp?: { initDataUnsafe?: { start_param?: string } } };
      }
    ).Telegram?.WebApp?.initDataUnsafe?.start_param;
    return startParam || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse startParam and return the mapped route.
 *
 * Tries three sources in order:
 * 1. Native Telegram WebApp bridge (most reliable, always set by Telegram)
 * 2. SDK retrieveLaunchParams (multi-source: href, perf entries, localStorage)
 * 3. Manual URL hash / search-param parsing (legacy fallback)
 *
 * @returns The mapped route path if startParam is valid, undefined otherwise.
 */
export function getStartParamRoute(): string | undefined {
  if (typeof window === "undefined") return undefined;

  const mapStartParamToRoute = (
    startParam: string | null | undefined
  ): string | undefined => {
    // Check for verification deeplink (vr_<userId>) first
    const verifyUserId = parseVerifyStartParam(startParam);
    if (verifyUserId) {
      return `/telegram/verify?userId=${verifyUserId}`;
    }

    const parsed = parseSummaryFeedStartParam(startParam ?? null);
    if (!parsed) {
      return undefined;
    }

    const params = new URLSearchParams({
      groupChatId: parsed.groupChatId,
      summaryId: parsed.summaryId,
    });

    return `/telegram/summaries/feed?${params.toString()}`;
  };

  // 1. Native Telegram WebApp bridge (most reliable)
  const nativeParam = getNativeStartParam();
  const routeFromNative = mapStartParamToRoute(nativeParam);
  if (routeFromNative) {
    return routeFromNative;
  }

  // 2. SDK extraction (handles various client hash formats)
  try {
    const launchParams = retrieveLaunchParams();
    const routeFromSdk = mapStartParamToRoute(launchParams.tgWebAppStartParam);
    if (routeFromSdk) {
      return routeFromSdk;
    }
  } catch {
    // SDK extraction failed (e.g. not in Telegram context) — fall through
  }

  // 3. Manual hash / search-param parsing for tgWebAppStartParam
  try {
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.slice(1));
      const startParam = params.get("tgWebAppStartParam");
      const routeFromHash = mapStartParamToRoute(startParam);
      if (routeFromHash) {
        return routeFromHash;
      }
    }

    const searchParams = new URLSearchParams(window.location.search);
    const startParam = searchParams.get("tgWebAppStartParam");
    const routeFromSearch = mapStartParamToRoute(startParam);
    if (routeFromSearch) {
      return routeFromSearch;
    }
  } catch (error) {
    console.debug("Failed to parse startParam from URL:", error);
  }

  // 4. Extract start_param from tgWebAppData blob in the URL
  // Some Telegram clients embed start_param only inside tgWebAppData
  // and don't expose it as a separate tgWebAppStartParam parameter.
  try {
    const allParams = window.location.href
      .replace(/^[^?#]*[?#]/, "")
      .replace(/[?#]/g, "&");
    const urlParams = new URLSearchParams(allParams);
    const tgWebAppData = urlParams.get("tgWebAppData");
    if (tgWebAppData) {
      const dataParams = new URLSearchParams(tgWebAppData);
      const startParam = dataParams.get("start_param");
      const routeFromData = mapStartParamToRoute(startParam);
      if (routeFromData) {
        return routeFromData;
      }
    }
  } catch (error) {
    console.debug("Failed to parse start_param from tgWebAppData:", error);
  }

  return undefined;
}

const CONSUMED_KEY = "deeplink_consumed_route";

/**
 * Returns the deeplink route only if it hasn't been consumed yet.
 * Use this in UI consumers to avoid re-triggering redirects on page refresh.
 */
export function getUnconsumedStartParamRoute(): string | undefined {
  const route = getStartParamRoute();
  if (!route) return undefined;
  try {
    if (sessionStorage.getItem(CONSUMED_KEY) === route) return undefined;
  } catch {
    // sessionStorage not available
  }
  return route;
}

/** Mark the deeplink route as consumed so page refreshes don't re-trigger it. */
export function markStartParamConsumed(route: string): void {
  try {
    sessionStorage.setItem(CONSUMED_KEY, route);
  } catch {
    // sessionStorage not available
  }
}
