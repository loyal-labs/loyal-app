import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Globe, GraduationCap, Settings, Wallet } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { type LayoutChangeEvent, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isWalletUnlocked, useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, View } from "@/tw";

import EarnTabIcon from "../../assets/images/earn/tab-bar-icon.svg";
import EarnTabIconActive from "../../assets/images/earn/tab-bar-icon-active.svg";

// The Earn screen lives at /(tabs)/index so it's the cold-start default,
// and the original wallet screen moved to /(tabs)/wallet.
const EARN_ROUTE_NAME = "index";

const TAB_ORDER = [
  "wallet",
  "browser",
  EARN_ROUTE_NAME,
  "library",
  "profile",
] as const;

type TabName = (typeof TAB_ORDER)[number];

const LUCIDE_ICONS = {
  wallet: Wallet,
  browser: Globe,
  library: GraduationCap,
  profile: Settings,
} as const;

const TAB_CELL_HEIGHT = 54;
const BLUR_PADDING = 4;
const INDICATOR_SIZE = 44;
const INDICATOR_TOP =
  (TAB_CELL_HEIGHT + BLUR_PADDING * 2 - INDICATOR_SIZE) / 2;

const SPRING_CONFIG = { damping: 20, stiffness: 240, mass: 0.7 };

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const wallet = useWallet();
  const insets = useSafeAreaInsets();

  const visibleRoutes = useMemo(
    () =>
      state.routes
        .map((route, index) => ({ route, index }))
        .filter(({ route }) =>
          (TAB_ORDER as readonly string[]).includes(route.name),
        )
        .sort(
          (left, right) =>
            TAB_ORDER.indexOf(left.route.name as TabName) -
            TAB_ORDER.indexOf(right.route.name as TabName),
        ),
    [state.routes],
  );

  const visibleIndex = useMemo(
    () => visibleRoutes.findIndex(({ index }) => index === state.index),
    [visibleRoutes, state.index],
  );

  // Measured tab-cell layouts. `layout.x` and `layout.width` are reported in
  // the BlurView's coordinate system; an absolute child with `left: 0` sits
  // at the same origin, so translateX matches directly without any
  // percentage / padding-box guesswork.
  const tabXs = useRef<number[]>([]);
  const tabWidths = useRef<number[]>([]);

  const indicatorX = useSharedValue(0);
  const indicatorOpacity = useSharedValue(0);

  const settleIndicator = useCallback(
    (animate: boolean) => {
      const i = visibleIndex;
      const x = tabXs.current[i];
      const w = tabWidths.current[i];
      if (i < 0 || x === undefined || w === undefined) return;
      const targetX = x + w / 2 - INDICATOR_SIZE / 2;
      if (animate) {
        indicatorX.value = withSpring(targetX, SPRING_CONFIG);
      } else {
        // First settle (cells just measured) — jump, don't animate from 0.
        indicatorX.value = targetX;
      }
      indicatorOpacity.value = 1;
    },
    [visibleIndex, indicatorX, indicatorOpacity],
  );

  const handleTabLayout = useCallback(
    (visI: number) => (e: LayoutChangeEvent) => {
      tabXs.current[visI] = e.nativeEvent.layout.x;
      tabWidths.current[visI] = e.nativeEvent.layout.width;
      // The active cell just measured — snap into place without an animation
      // so the indicator doesn't fly in from x=0 on mount.
      if (visI === visibleIndex && indicatorOpacity.value === 0) {
        settleIndicator(false);
      }
    },
    [visibleIndex, indicatorOpacity, settleIndicator],
  );

  useEffect(() => {
    settleIndicator(true);
  }, [settleIndicator]);

  const indicatorAnimatedStyle = useAnimatedStyle(() => ({
    opacity: indicatorOpacity.value,
    transform: [{ translateX: indicatorX.value }],
  }));

  const wrapperStyle = useMemo(
    () => [styles.wrapper, { paddingBottom: Math.max(insets.bottom, 12) }],
    [insets.bottom],
  );

  const handlePress = useCallback(
    (routeName: string, originalIndex: number) => {
      const event = navigation.emit({
        type: "tabPress",
        target: state.routes[originalIndex].key,
        canPreventDefault: true,
      });

      if (!event.defaultPrevented && state.index !== originalIndex) {
        void Haptics.selectionAsync();
        navigation.navigate(routeName);
      }
    },
    [navigation, state],
  );

  if (!isWalletUnlocked(wallet.state)) return null;

  const focusedRouteName = visibleRoutes[visibleIndex]?.route.name;
  // Earn supplies its own active pill (the SVG), so no circle behind it.
  const showSlider = focusedRouteName !== EARN_ROUTE_NAME;

  return (
    <View style={wrapperStyle}>
      <BlurView
        intensity={40}
        tint="systemChromeMaterialLight"
        style={styles.blur}
      >
        {showSlider && (
          <Animated.View
            style={[styles.indicator, indicatorAnimatedStyle]}
            pointerEvents="none"
          />
        )}

        {visibleRoutes.map(({ route, index: originalIndex }, visI) => {
          const isFocused = state.index === originalIndex;
          const name = route.name as TabName;
          const isEarn = name === EARN_ROUTE_NAME;

          return (
            <Pressable
              key={route.key}
              style={styles.tab}
              onPress={() => handlePress(route.name, originalIndex)}
              onLayout={handleTabLayout(visI)}
              accessibilityRole="tab"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={isEarn ? "Earn" : undefined}
            >
              {isEarn ? (
                isFocused ? (
                  <EarnTabIconActive width={61} height={44} />
                ) : (
                  <EarnTabIcon width={61} height={44} />
                )
              ) : (
                (() => {
                  const Icon =
                    LUCIDE_ICONS[name as keyof typeof LUCIDE_ICONS];
                  return (
                    <Icon
                      size={28}
                      color="#000"
                      strokeWidth={1.6}
                      opacity={isFocused ? 1 : 0.4}
                    />
                  );
                })()
              )}
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
    backgroundColor: "rgba(242, 242, 247, 0.94)",
    borderRadius: 9999,
    padding: BLUR_PADDING,
    overflow: "hidden",
  },
  tab: {
    flex: 1,
    height: TAB_CELL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9999,
  },
  indicator: {
    position: "absolute",
    top: INDICATOR_TOP,
    left: 0,
    width: INDICATOR_SIZE,
    height: INDICATOR_SIZE,
    borderRadius: INDICATOR_SIZE / 2,
    backgroundColor: "rgba(60, 60, 67, 0.08)",
  },
});
