"use client";

import type { AuthSessionUser } from "@loyal-labs/auth-core";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { useAuthSession } from "@/contexts/auth-session-context";
import { usePublicEnv } from "@/contexts/public-env-context";
import {
  identifyAuthenticatedUser,
  initAnalytics,
  resetAuthenticatedUser,
  trackAuthSignInSucceeded,
  trackPageView,
} from "@/lib/core/analytics";
import { X_PIXEL_EVENTS, xPixelEvent } from "@/lib/core/x-pixel";

export type ShouldTrackFrontendPageViewParams = {
  pathname: string | null;
  lastTrackedPath: string | null;
};

export type ShouldTrackAuthSignInSuccessParams = {
  nextUser: AuthSessionUser | null;
  previousUser: AuthSessionUser | null;
};

export function shouldTrackFrontendPageView({
  pathname,
  lastTrackedPath,
}: ShouldTrackFrontendPageViewParams): boolean {
  return Boolean(pathname && pathname !== lastTrackedPath);
}

export function shouldTrackAuthSignInSuccess({
  nextUser,
  previousUser,
}: ShouldTrackAuthSignInSuccessParams): boolean {
  return previousUser === null && nextUser !== null;
}

const X_PIXEL_SIGNUP_STORAGE_KEY = "loyal_x_pixel_signup_fired_v1";

function hasXPixelSignupBeenFired(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(X_PIXEL_SIGNUP_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markXPixelSignupFired(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(X_PIXEL_SIGNUP_STORAGE_KEY, "1");
  } catch {
    // Storage may be unavailable; we accept that the event may fire again on
    // a future session rather than swallowing the conversion entirely.
  }
}

export function fireXPixelSignupIfNeeded(): void {
  if (hasXPixelSignupBeenFired()) {
    return;
  }
  xPixelEvent(X_PIXEL_EVENTS.signup);
  markXPixelSignupFired();
}

export function AnalyticsBootstrap() {
  const pathname = usePathname();
  const publicEnv = usePublicEnv();
  const { user } = useAuthSession();
  const lastTrackedPathRef = useRef<string | null>(null);
  const previousUserRef = useRef<AuthSessionUser | null>(null);

  useEffect(() => {
    void initAnalytics(publicEnv);
  }, [publicEnv]);

  useEffect(() => {
    if (!shouldTrackFrontendPageView({
      pathname,
      lastTrackedPath: lastTrackedPathRef.current,
    })) {
      return;
    }

    lastTrackedPathRef.current = pathname;
    trackPageView(publicEnv, pathname!);
  }, [pathname, publicEnv]);

  useEffect(() => {
    if (!user) {
      resetAuthenticatedUser();
      return;
    }

    identifyAuthenticatedUser(publicEnv, user);
  }, [publicEnv, user]);

  useEffect(() => {
    if (
      shouldTrackAuthSignInSuccess({
        nextUser: user,
        previousUser: previousUserRef.current,
      })
    ) {
      trackAuthSignInSucceeded(publicEnv, user!);
      fireXPixelSignupIfNeeded();
    }

    previousUserRef.current = user;
  }, [publicEnv, user]);

  return null;
}
