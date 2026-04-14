import "@/global.css";

import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";

import { SplashAnimation } from "@/components/SplashAnimation";
import { WalletAuthGate } from "@/components/wallet/WalletAuthGate";
import { WalletProvider } from "@/lib/wallet/wallet-provider";
import {
  // addNotificationResponseListener, // Summaries — kept for reinstatement
  registerForPushNotifications,
  registerPushToken,
  setupNotificationHandler,
} from "@/services/notifications";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);

  const [fontsLoaded] = useFonts({
    Geist_400Regular: require("@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf"),
    Geist_500Medium: require("@expo-google-fonts/geist/500Medium/Geist_500Medium.ttf"),
    Geist_600SemiBold: require("@expo-google-fonts/geist/600SemiBold/Geist_600SemiBold.ttf"),
    Geist_700Bold: require("@expo-google-fonts/geist/700Bold/Geist_700Bold.ttf"),
  });

  // Hide native splash once fonts are ready — Lottie takes over
  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  // Register for push notifications on boot
  useEffect(() => {
    (async () => {
      await setupNotificationHandler();
      const token = await registerForPushNotifications();
      if (token) {
        await registerPushToken(token);
      }
    })();
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
          <StatusBar style="auto" />
          <WalletAuthGate />
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
            <Stack.Screen
              name="login"
              options={{ headerShown: false, presentation: "modal" }}
            />
            {/* Summaries detail screen commented out — kept for potential reinstatement */}
            {/* <Stack.Screen name="summaries/[groupChatId]" /> */}
          </Stack>
        </WalletProvider>
        {showSplash && <SplashAnimation onFinish={handleSplashFinish} />}
      </BottomSheetModalProvider>
    </GestureHandlerRootView>
  );
}
