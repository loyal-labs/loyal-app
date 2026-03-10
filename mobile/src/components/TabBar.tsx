import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";

import { BlurView } from "expo-blur";
import { MessageCircleMore, User, Wallet } from "lucide-react-native";
import { useCallback, useEffect, useMemo } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Pressable, View } from "@/tw";

const TAB_ICONS = {
  index: MessageCircleMore,
  wallet: Wallet,
  profile: User,
} as const;

const SPRING_CONFIG = { damping: 18, stiffness: 220, mass: 0.8 };

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const tabCount = state.routes.length;
  const indicatorPosition = useSharedValue(state.index);

  const wrapperStyle = useMemo(
    () => [styles.wrapper, { paddingBottom: Math.max(insets.bottom, 12) }],
    [insets.bottom],
  );

  useEffect(() => {
    indicatorPosition.value = withSpring(state.index, SPRING_CONFIG);
  }, [state.index]);

  const indicatorStyle = useAnimatedStyle(() => ({
    left: `${(indicatorPosition.value / tabCount) * 100}%`,
    width: `${100 / tabCount}%`,
  }));

  const handlePress = useCallback(
    (routeName: string, index: number) => {
      const event = navigation.emit({
        type: "tabPress",
        target: state.routes[index].key,
        canPreventDefault: true,
      });

      if (!event.defaultPrevented && state.index !== index) {
        navigation.navigate(routeName);
      }
    },
    [navigation, state],
  );

  return (
    <View style={wrapperStyle}>
      <BlurView intensity={40} tint="systemChromeMaterialLight" style={styles.blur}>
        {/* Sliding indicator */}
        <Animated.View style={[styles.indicator, indicatorStyle]} />

        {/* Tab items */}
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const Icon = TAB_ICONS[route.name as keyof typeof TAB_ICONS];
          if (!Icon) return null;

          return (
            <Pressable
              key={route.key}
              style={styles.tab}
              onPress={() => handlePress(route.name, index)}
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
