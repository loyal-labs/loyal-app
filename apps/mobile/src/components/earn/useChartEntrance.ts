import { useEffect } from "react";
import {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const ENTER_EASING = Easing.bezier(0.22, 1, 0.36, 1);
const APPEAR_DURATION = 360;
const APPEAR_RISE = 8;
const GROW_DURATION = 720;

// Entrance animation for the Earn line charts (APY, Forecast) — parity with the
// Earnings bar chart, which fades + rises in and grows its bars up from the
// baseline. `rootStyle` fades + rises the whole panel (headline + chart);
// `chartStyle` grows the plotted lines up from the baseline once measured.
// Pass `ready` (chart measured + has data) to kick off the grow.
export function useChartEntrance(ready: boolean) {
  const appear = useSharedValue(0);
  const grow = useSharedValue(0);

  useEffect(() => {
    appear.value = withTiming(1, {
      duration: APPEAR_DURATION,
      easing: ENTER_EASING,
    });
    return () => cancelAnimation(appear);
  }, [appear]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    grow.value = withTiming(1, {
      duration: GROW_DURATION,
      easing: ENTER_EASING,
    });
    return () => cancelAnimation(grow);
  }, [ready, grow]);

  const rootStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [
      { translateY: interpolate(appear.value, [0, 1], [APPEAR_RISE, 0]) },
    ],
  }));

  const chartStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: grow.value }],
  }));

  return { rootStyle, chartStyle };
}
