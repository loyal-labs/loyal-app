"use client";

import { useEffect, useState } from "react";

import { AnalyticsBootstrapClient } from "@/components/analytics/AnalyticsBootstrapClient";
import Header from "@/components/Header";
import { TelegramAppRootClient } from "@/components/telegram/TelegramAppRootClient";
import { TelegramProvider } from "@/components/telegram/TelegramProvider";
import { useDeviceSafeAreaTop } from "@/hooks/useTelegramSafeArea";
import { initTelegram } from "@/lib/telegram/mini-app";

export default function TelegramLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const safeAreaInsetTop = useDeviceSafeAreaTop();
  // Gate layout visibility until safe area value is known (prevents content jump)
  const [safeAreaReady, setSafeAreaReady] = useState(false);

  // Initialize Telegram SDK + viewport at layout level so safe area
  // values are available for all pages.
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

  // Header height: safe area + 10px + logo (27px) + padding bottom (16px)
  const headerHeight = Math.max(safeAreaInsetTop || 0, 12) + 10 + 27 + 16;

  return (
    <TelegramAppRootClient>
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
          <div
            className="flex flex-1 flex-col"
            style={{ paddingTop: headerHeight }}
          >
            {children}
          </div>
        </div>
      </TelegramProvider>
    </TelegramAppRootClient>
  );
}
