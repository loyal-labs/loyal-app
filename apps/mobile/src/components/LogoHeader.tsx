import { StyleSheet } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text, View } from "@/tw";

import Logo from "../../assets/images/logo.svg";

type LogoHeaderProps = {
  scrollY?: SharedValue<number>;
  morphText?: string | null;
  morphColor?: string;
  morphTextColor?: string;
  morphStart?: number;
  morphEnd?: number;
};

export function LogoHeader({
  scrollY,
  morphText,
  morphColor = "#1c1c1e",
  morphTextColor = "#ffffff",
  morphStart = 80,
  morphEnd = 180,
}: LogoHeaderProps) {
  const { top } = useSafeAreaInsets();
  const fallbackScrollY = useSharedValue(0);
  const effectiveScrollY = scrollY ?? fallbackScrollY;
  const morphEnabled = !!scrollY && !!morphText;

  const containerStyle = useAnimatedStyle(() => {
    if (!morphEnabled) return { backgroundColor: "#ffffff" };
    const t = interpolate(
      effectiveScrollY.value,
      [morphStart, morphEnd],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      backgroundColor: interpolateColor(t, [0, 1], ["#ffffff", morphColor]),
    };
  });

  const logoStyle = useAnimatedStyle(() => {
    if (!morphEnabled) return { opacity: 1 };
    const t = interpolate(
      effectiveScrollY.value,
      [morphStart, morphEnd],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      opacity: 1 - t,
      transform: [{ translateY: -t * 10 }],
    };
  });

  const balanceStyle = useAnimatedStyle(() => {
    if (!morphEnabled) return { opacity: 0 };
    const t = interpolate(
      effectiveScrollY.value,
      [morphStart, morphEnd],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      opacity: t,
      transform: [{ translateY: (1 - t) * 10 }],
    };
  });

  return (
    <Animated.View
      style={[styles.container, { paddingTop: top + 12 }, containerStyle]}
    >
      <View style={styles.content}>
        <Animated.View style={[styles.layer, logoStyle]}>
          <Logo width={98} height={29} />
        </Animated.View>
        {morphEnabled ? (
          <Animated.View style={[styles.layer, balanceStyle]}>
            <Text
              style={[styles.balanceText, { color: morphTextColor }]}
              numberOfLines={1}
            >
              {morphText}
            </Text>
          </Animated.View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 8,
  },
  content: {
    height: 29,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  layer: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  balanceText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "600",
    lineHeight: 22,
  },
});
