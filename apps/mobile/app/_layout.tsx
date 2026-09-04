import "@/global.css";

import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";

import { DatadogInit } from "@/components/DatadogInit";
import { ObservabilityInit } from "@/components/ObservabilityInit";
import { OtaUpdateBanner } from "@/components/OtaUpdateBanner";
import { PushTokenRegistrar } from "@/components/PushTokenRegistrar";
import { SplashAnimation } from "@/components/SplashAnimation";
import { WalletAuthGate } from "@/components/wallet/WalletAuthGate";
import { initAnalytics, track } from "@/lib/analytics/analytics";
import { APP_EVENTS } from "@/lib/analytics/app-events";
import { initAttribution } from "@/lib/analytics/attribution";
import { AppReadyProvider } from "@/lib/app-ready";
import { SignApprovalProvider } from "@/lib/wallet/sign-approval";
import { WalletProvider } from "@/lib/wallet/wallet-provider";
import {
  // addNotificationResponseListener, // Summaries — kept for reinstatement
  setupNotificationHandler,
} from "@/services/notifications";
import { initOneSignal } from "@/services/onesignal";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);

  const [fontsLoaded] = useFonts({
    Geist_400Regular: require("@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf"),
    Geist_500Medium: require("@expo-google-fonts/geist/500Medium/Geist_500Medium.ttf"),
    Geist_600SemiBold: require("@expo-google-fonts/geist/600SemiBold/Geist_600SemiBold.ttf"),
    Geist_700Bold: require("@expo-google-fonts/geist/700Bold/Geist_700Bold.ttf"),
    Geist_900Black: require("@expo-google-fonts/geist/900Black/Geist_900Black.ttf"),
  });

  // Hide native splash once fonts are ready — Lottie takes over
  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  // One-time display config (Android channel, handler). Per-wallet token
  // registration happens inside <PushTokenRegistrar /> below.
  useEffect(() => {
    void setupNotificationHandler();
    void initOneSignal();
  }, []);

  // Initialize Mixpanel as early as possible so identify/track from wallet
  // boot are not lost. "App Opened" fires on cold start and every foreground —
  // retention cohorts (ASK-1651) key off its recency.
  useEffect(() => {
    void initAnalytics();
    track(APP_EVENTS.opened);
    // twclid/utm_* capture from deep links + Android install referrer.
    const removeAttributionListener = initAttribution();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        track(APP_EVENTS.opened);
      }
    });
    return () => {
      subscription.remove();
      removeAttributionListener();
    };
  }, []);

  // Handle notification tap while app is running
  // Summaries navigation commented out — kept for potential reinstatement
  // useEffect(() => {
  //   let cleanup: (() => void) | null = null;
  //
  //   addNotificationResponseListener((data) => {
  //     if (data?.screen === "summaries") {
  //       router.push("/");
  //     }
  //   }).then((remove) => {
  //     cleanup = remove;
  //   });
  //
  //   return () => cleanup?.();
  // }, [router]);

  const handleSplashFinish = useCallback(() => {
    setShowSplash(false);
  }, []);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomSheetModalProvider>
        <WalletProvider>
          <SignApprovalProvider>
            <DatadogInit />
            <ObservabilityInit />
            <PushTokenRegistrar />
            <StatusBar style="auto" />
            <WalletAuthGate />
            <AppReadyProvider splashDone={!showSplash}>
              <Stack
                screenOptions={{
                  headerBackButtonDisplayMode: "minimal",
                }}
              >
                <Stack.Screen
                  name="(tabs)"
                  options={{ headerShown: false }}
                />
                <Stack.Screen
                  name="token/[mint]"
                  options={{ headerShown: false }}
                />
                {/* Category pages morph out of the tapped wallet card. Use
                    `containedTransparentModal` (NOT `transparentModal`): it stays
                    transparent so the wallet shows behind, but is contained in the
                    navigator rather than presented as a native modal — so there's
                    no native present/dismiss slide that `animation: "none"` can't
                    suppress (that slide was the jump at the end of close).
                    CardExpandTransition drives the entire motion. */}
                <Stack.Screen
                  name="wallet/stablecoins"
                  options={{
                    headerShown: false,
                    presentation: "containedTransparentModal",
                    animation: "none",
                    gestureEnabled: false,
                  }}
                />
                <Stack.Screen
                  name="wallet/crypto"
                  options={{
                    headerShown: false,
                    presentation: "containedTransparentModal",
                    animation: "none",
                    gestureEnabled: false,
                  }}
                />
                <Stack.Screen
                  name="browser/site"
                  options={{ headerShown: false }}
                />
                {/* Summaries detail screen commented out — kept for potential reinstatement */}
                {/* <Stack.Screen name="summaries/[groupChatId]" /> */}
              </Stack>
            </AppReadyProvider>
            <OtaUpdateBanner />
          </SignApprovalProvider>
        </WalletProvider>
        {showSplash && <SplashAnimation onFinish={handleSplashFinish} />}
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
