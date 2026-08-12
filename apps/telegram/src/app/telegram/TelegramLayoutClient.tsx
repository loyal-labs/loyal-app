"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Toaster } from "sileo";

import { AnalyticsBootstrapClient } from "@/components/analytics/AnalyticsBootstrapClient";
import Header from "@/components/Header";
import BottomNav from "@/components/telegram/BottomNav";
import { TelegramAppRootClient } from "@/components/telegram/TelegramAppRootClient";

const Onboarding = dynamic(
  () => import("@/components/telegram/Onboarding"),
  { ssr: false }
);
const WalletCreationScreen = dynamic(
  () => import("@/components/telegram/WalletCreationScreen"),
  { ssr: false }
);
import { TelegramProvider } from "@/components/telegram/TelegramProvider";
import {
  getUnconsumedStartParamRoute,
  markStartParamConsumed,
} from "@/hooks/useStartParam";
import { useDeviceSafeAreaTop } from "@/hooks/useTelegramSafeArea";
import { track } from "@/lib/core/analytics";
import { initTelegram } from "@/lib/telegram/mini-app";
import {
  getCloudValue,
  setCloudValue,
} from "@/lib/telegram/mini-app/cloud-storage";

import type { OnboardingCompletionMethod } from "./onboarding-analytics";
import { ONBOARDING_ANALYTICS_EVENTS } from "./onboarding-analytics";

const ONBOARDING_DONE_KEY = "onboarding_done";

// Set to true to force the onboarding + wallet creation flow for testing,
// even if you already have a wallet and completed onboarding.
export const DEBUG_FORCE_ONBOARDING = false;

export default function TelegramLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const safeAreaInsetTop = useDeviceSafeAreaTop();
  const pathname = usePathname();
  // null = loading, true = show, false = don't show
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  // Intermediate state: wallet is being created after onboarding
  const [creatingWallet, setCreatingWallet] = useState(false);
  // Gate layout visibility until safe area value is known (prevents content jump)
  const [safeAreaReady, setSafeAreaReady] = useState(false);

  // Detect deeplink synchronously on first render to prevent
  // flash of cached page content (black screen / flicker).
  const [deeplinkRoute, setDeeplinkRoute] = useState<string | undefined>(
    () => {
      if (typeof window === "undefined") return undefined;
      return getUnconsumedStartParamRoute();
    }
  );

  // Redirect to deeplink route once on mount
  useEffect(() => {
    if (!deeplinkRoute) return;
    if (pathname !== deeplinkRoute.split("?")[0]) {
      router.replace(deeplinkRoute);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // Mark consumed and clear state once navigation to target completes,
  // so refreshes and back-navigation don't re-trigger the redirect.
  useEffect(() => {
    if (!deeplinkRoute) return;
    if (pathname === deeplinkRoute.split("?")[0]) {
      markStartParamConsumed(deeplinkRoute);
      setDeeplinkRoute(undefined);
    }
  }, [deeplinkRoute, pathname]);

  // Initialize Telegram SDK + viewport at layout level so safe area
  // values are available for all pages, not just the wallet page.
  useEffect(() => {
    initTelegram();
  }, []);

  // Mark safe area as ready once the SDK provides a non-zero value.
  // Timeout fallback for devices without a notch (safeAreaInsetTop is genuinely 0).
  useEffect(() => {
    if (safeAreaInsetTop > 0) setSafeAreaReady(true);
  }, [safeAreaInsetTop]);

  useEffect(() => {
    if (safeAreaReady) return;
    const timer = setTimeout(() => setSafeAreaReady(true), 150);
    return () => clearTimeout(timer);
  }, [safeAreaReady]);

  // Check cloud storage for onboarding completion
  useEffect(() => {
    if (DEBUG_FORCE_ONBOARDING) {
      setShowOnboarding(true);
      track(ONBOARDING_ANALYTICS_EVENTS.onboardingStarted);
      return;
    }

    const timeout = setTimeout(() => {
      // Fallback: if cloud storage never responds (e.g. SDK init failed),
      // assume onboarding is done so the app doesn't stay blank.
      setShowOnboarding((prev) => (prev === null ? false : prev));
    }, 2000);

    getCloudValue(ONBOARDING_DONE_KEY)
      .then((value) => {
        clearTimeout(timeout);
        const shouldShow = value !== "1";
        setShowOnboarding(shouldShow);
        if (shouldShow) {
          track(ONBOARDING_ANALYTICS_EVENTS.onboardingStarted);
        }
      })
      .catch(() => {
        clearTimeout(timeout);
        // Cloud storage unavailable — skip onboarding to unblock the app.
        setShowOnboarding(false);
      });

    return () => clearTimeout(timeout);
  }, []);

  const handleOnboardingDone = (method: OnboardingCompletionMethod) => {
    track(ONBOARDING_ANALYTICS_EVENTS.onboardingEnded, { method });
    setShowOnboarding(false);
    setCreatingWallet(true);
    void setCloudValue(ONBOARDING_DONE_KEY, "1");
  };

  const handleWalletReady = useCallback(() => {
    setCreatingWallet(false);
  }, []);

  // Reset scroll position when navigating between pages
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  // Header height: safe area + 10px + logo (27px) + padding bottom (16px)
  const headerHeight = Math.max(safeAreaInsetTop || 0, 12) + 10 + 27 + 16;

  // While redirecting to deeplink, render blank screen to avoid flashing
  // the cached page content before navigation completes.
  const isRedirecting =
    deeplinkRoute && pathname !== deeplinkRoute.split("?")[0];

  if (isRedirecting) {
    return <div style={{ background: "#fff", minHeight: "100vh" }} />;
  }

  return (
    <TelegramAppRootClient>
      <Toaster
        position="top-center"
        offset={headerHeight}
        options={{
          fill: "black",
          styles: {
            title: "text-white!",
            description: "text-white/75!",
          },
        }}
      />
      <AnalyticsBootstrapClient />
      <TelegramProvider>
        <div
          className="flex flex-col"
          style={{
            background: "#fff",
            minHeight: "100vh",
            visibility: safeAreaReady ? "visible" : "hidden",
          }}
        >
          <Header />
          {showOnboarding ? (
            <Onboarding
              headerHeight={headerHeight}
              onDone={handleOnboardingDone}
            />
          ) : creatingWallet ? (
            <WalletCreationScreen
              headerHeight={headerHeight}
              onWalletReady={handleWalletReady}
            />
          ) : showOnboarding === false ? (
            <>
              <div
                className="flex flex-1 flex-col"
                style={{ paddingTop: headerHeight }}
              >
                {children}
              </div>
              <BottomNav />
            </>
          ) : null}
        </div>
      </TelegramProvider>
    </TelegramAppRootClient>
  );
}
