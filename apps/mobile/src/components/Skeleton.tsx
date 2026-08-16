import type { ReactNode } from "react";
import { useEffect } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

// Opacity the pulse breathes between. Stops short of 0 so the block never fully
// vanishes — it should read as "loading", not "gone".
const PULSE_MIN = 0.35;
const PULSE_MAX = 1;
const PULSE_MS = 750;

// Default tint for light surfaces (system gray on near-white). On dark surfaces
// pass a translucent-white `backgroundColor` through `style`.
const DEFAULT_TINT = "#E5E5EA";

// A pulsing loading placeholder. Two shapes from one component:
//   • no children → a filled, rounded block sized by `style` (number/text stand-in)
//   • with children → a transparent wrapper that pulses its children together,
//     so one driver animates a whole group (e.g. a row of skeleton bars).
export function Skeleton({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const opacity = useSharedValue(PULSE_MAX);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(PULSE_MIN, {
        duration: PULSE_MS,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        children ? null : { backgroundColor: DEFAULT_TINT, borderRadius: 8 },
        style,
        animatedStyle,
      ]}
    >
      {children}
    </Animated.View>
  );
}
