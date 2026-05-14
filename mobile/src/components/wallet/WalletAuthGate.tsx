import { ActivityIndicator, StyleSheet } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { LockScreen } from "@/components/wallet/LockScreen";
import { OnboardingGate } from "@/components/wallet/OnboardingGate";
import { isWalletUnlocked, useWallet } from "@/lib/wallet/wallet-provider";
import { View } from "@/tw";

/**
 * Full-screen overlay rendered above the tab navigator.
 * Covers the entire app when wallet is loading, locked, or doesn't exist.
 * Returns null when unlocked (including vault-unlocked) — the normal tab
 * UI shows through.
 */
export function WalletAuthGate() {
  const { state, onboardingReplayActive, finishOnboardingReplay } = useWallet();

  if (isWalletUnlocked(state) && !onboardingReplayActive) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(250)}
      style={styles.overlay}
    >
      {onboardingReplayActive && (
        <OnboardingGate mode="replay" onReplayDone={finishOnboardingReplay} />
      )}
      {!onboardingReplayActive && state === "loading" && (
        <View className="flex-1 items-center justify-center bg-white">
          <ActivityIndicator size="large" color="#000" />
        </View>
      )}
      {!onboardingReplayActive && state === "noWallet" && <OnboardingGate />}
      {!onboardingReplayActive && state === "locked" && <LockScreen />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
    zIndex: 100,
  },
});
