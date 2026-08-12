"use client";

import { useRawInitData } from "@telegram-apps/sdk-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  clearTelegramLaunchContext,
  identifyTelegramUser,
  initAnalytics,
  setTelegramLaunchContext,
  track,
} from "@/lib/core/analytics";
import { identifyDatadogUser } from "@/lib/core/datadog";
import { parseTelegramAnalyticsContextFromInitData } from "@/lib/telegram/mini-app/init-data-transform";

const IDENTITY_WAIT_TIMEOUT_MS = 1500;

type ShouldTrackTelegramPageViewParams = {
  pathname: string | null;
  didTrackForCurrentPath: boolean;
  hasIdentity: boolean;
  canTrackWithoutIdentity: boolean;
};

export const shouldTrackTelegramPageView = ({
  pathname,
  didTrackForCurrentPath,
  hasIdentity,
  canTrackWithoutIdentity,
}: ShouldTrackTelegramPageViewParams): boolean => {
  if (!pathname || !pathname.startsWith("/telegram")) {
    return false;
  }

  if (didTrackForCurrentPath) {
    return false;
  }

  if (!hasIdentity && !canTrackWithoutIdentity) {
    return false;
  }

  return true;
};

export const getTelegramPageViewEventName = (pathname: string): string =>
  `View ${pathname}`;

export function AnalyticsBootstrap() {
  const pathname = usePathname();
  const rawInitData = useRawInitData();
  const telegramAnalyticsContext = useMemo(
    () => parseTelegramAnalyticsContextFromInitData(rawInitData),
    [rawInitData]
  );
  const telegramIdentity = telegramAnalyticsContext?.identity ?? null;
  const telegramLaunchContext = telegramAnalyticsContext?.launchContext ?? null;
  const lastTrackedPathRef = useRef<string | null>(null);
  const didTrackFirstTelegramPageRef = useRef(false);
  const [canTrackWithoutIdentity, setCanTrackWithoutIdentity] = useState(false);

  useEffect(() => {
    void initAnalytics();
  }, []);

  useEffect(() => {
    if (!pathname || !pathname.startsWith("/telegram")) {
      clearTelegramLaunchContext();
      return;
    }

    setTelegramLaunchContext(telegramLaunchContext);

    if (telegramIdentity) {
      identifyTelegramUser(telegramIdentity);
      identifyDatadogUser(telegramIdentity);
    }
  }, [pathname, telegramIdentity, telegramLaunchContext]);

  useEffect(() => {
    if (!pathname || !pathname.startsWith("/telegram")) {
      setCanTrackWithoutIdentity(false);
      return;
    }

    if (rawInitData) {
      setCanTrackWithoutIdentity(true);
      return;
    }

    setCanTrackWithoutIdentity(false);
    const timeoutId = window.setTimeout(() => {
      setCanTrackWithoutIdentity(true);
    }, IDENTITY_WAIT_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pathname, rawInitData]);

  useEffect(() => {
    if (!pathname || !pathname.startsWith("/telegram")) {
      return;
    }

    if (lastTrackedPathRef.current !== pathname) {
      didTrackFirstTelegramPageRef.current = false;
    }

    if (
      !shouldTrackTelegramPageView({
        pathname,
        didTrackForCurrentPath: didTrackFirstTelegramPageRef.current,
        hasIdentity: Boolean(telegramIdentity),
        canTrackWithoutIdentity,
      })
    ) {
      return;
    }

    lastTrackedPathRef.current = pathname;
    didTrackFirstTelegramPageRef.current = true;

    track(getTelegramPageViewEventName(pathname), { path: pathname });
  }, [canTrackWithoutIdentity, pathname, telegramIdentity]);

  return null;
}
