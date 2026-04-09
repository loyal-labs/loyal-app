import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

import { BlurView } from "expo-blur";
import { Settings, Wallet } from "lucide-react-native";
import { useCallback, useEffect, useMemo } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isWalletUnlocked, useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, View } from "@/tw";

const TAB_ICONS = {
  index: Wallet,
  profile: Settings,
} as const;

const SPRING_CONFIG = { damping: 18, stiffness: 220, mass: 0.8 };

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const wallet = useWallet();
  const insets = useSafeAreaInsets();

  // Filter to only tabs that have icons (excludes hidden summaries tab)
  const visibleRoutes = useMemo(
    () =>
      state.routes
        .map((route, index) => ({ route, index }))
        .filter(({ route }) => route.name in TAB_ICONS),
    [state.routes],
  );
  const tabCount = visibleRoutes.length;

  const visibleIndex = useMemo(
    () => visibleRoutes.findIndex(({ index }) => index === state.index),
    [visibleRoutes, state.index],
  );

  const indicatorPosition = useSharedValue(Math.max(visibleIndex, 0));

  const wrapperStyle = useMemo(
    () => [styles.wrapper, { paddingBottom: Math.max(insets.bottom, 12) }],
    [insets.bottom],
  );

  useEffect(() => {
    if (visibleIndex >= 0) {
      indicatorPosition.value = withSpring(visibleIndex, SPRING_CONFIG);
    }
  }, [visibleIndex]);

  const indicatorStyle = useAnimatedStyle(() => ({
    left: `${(indicatorPosition.value / tabCount) * 100}%`,
    width: `${100 / tabCount}%`,
  }));

  const handlePress = useCallback(
    (routeName: string, originalIndex: number) => {
      const event = navigation.emit({
        type: "tabPress",
        target: state.routes[originalIndex].key,
        canPreventDefault: true,
      });

      if (!event.defaultPrevented && state.index !== originalIndex) {
        navigation.navigate(routeName);
      }
    },
    [navigation, state],
  );

  // Hide tab bar when wallet is not unlocked (onboarding, lock screen)
  if (!isWalletUnlocked(wallet.state)) return null;

  return (
    <View style={wrapperStyle}>
      <BlurView intensity={40} tint="systemChromeMaterialLight" style={styles.blur}>
        {/* Sliding indicator */}
        <Animated.View style={[styles.indicator, indicatorStyle]} />

        {/* Tab items */}
        {visibleRoutes.map(({ route, index: originalIndex }) => {
          const isFocused = state.index === originalIndex;
          const Icon = TAB_ICONS[route.name as keyof typeof TAB_ICONS];

          return (
            <Pressable
              key={route.key}
              style={styles.tab}
              onPress={() => handlePress(route.name, originalIndex)}
              accessibilityRole="tab"
              accessibilityState={isFocused ? { selected: true } : {}}
            >
              <Icon
                size={28}
                color="#000"
                strokeWidth={1.6}
                opacity={isFocused ? 1 : 0.4}
              />
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  blur: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(242, 242, 247, 0.7)",
    borderRadius: 9999,
    padding: 4,
    overflow: "hidden",
  },
  indicator: {
    position: "absolute",
    top: 4,
    bottom: 4,
    backgroundColor: "rgba(60, 60, 67, 0.06)",
    borderRadius: 9999,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 13,
    borderRadius: 9999,
  },
});
