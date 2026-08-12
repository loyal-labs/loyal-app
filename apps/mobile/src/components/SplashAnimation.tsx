import LottieView from "lottie-react-native";
import { useCallback, useRef } from "react";
import { StyleSheet } from "react-native";
import Animated, { FadeOut } from "react-native-reanimated";

type SplashAnimationProps = {
  onFinish: () => void;
};

export function SplashAnimation({ onFinish }: SplashAnimationProps) {
  const hasFinished = useRef(false);

  const handleAnimationFinish = useCallback(() => {
    if (hasFinished.current) return;
    hasFinished.current = true;
    onFinish();
  }, [onFinish]);

  return (
    <Animated.View exiting={FadeOut.duration(400)} style={styles.container}>
      <LottieView
        source={require("../../assets/images/spinner.json")}
        autoPlay
        loop={false}
        speed={1}
        onAnimationFinish={handleAnimationFinish}
        style={styles.animation}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    zIndex: 10,
  },
  animation: {
    width: 200,
    height: 200,
  },
});
