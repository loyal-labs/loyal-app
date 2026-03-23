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
    }

    previousUserRef.current = user;
  }, [publicEnv, user]);

  return null;
}
