import * as Haptics from "expo-haptics";
import { Shield } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Animated, Linking, PanResponder, StyleSheet } from "react-native";

import { Pressable, Text, View } from "@/tw";
import { Image } from "@/tw/image";

const AUTO_ROTATE_MS = 4000;
const SLIDE_DURATION = 240;
const SWIPE_THRESHOLD = 28;
const BRAND_RED = "#f9363c";
const DOT_DIM = "rgba(60, 60, 67, 0.18)";
const TITLE_COLOR = "#3C3C43";

type Banner = {
  id: string;
  title: string;
  icon: ReactNode;
  onPress: () => void;
};

type Props = {
  onShield: () => void;
};

// Bottom-right cell of the wallet grid (Figma 141:5931). A vertically-sliding
// promo carousel: tap opens the active banner's action, swipe up/down (or the
// 4s auto-rotate) advances, and the dots sit stacked on the right edge.
export function BannerCard({ onShield }: Props) {
  const banners: Banner[] = [
    {
      id: "earn",
      title: "Earn up to 8% APY on shielded dollars",
      icon: (
        <View style={[styles.iconSquare, { backgroundColor: BRAND_RED }]}>
          <Shield size={20} color="#FFFFFF" strokeWidth={2} />
        </View>
      ),
      onPress: onShield,
    },
    {
      id: "follow",
      title: "Follow Loyal on X for latest announcements",
      icon: (
        <Image
          source={require("../../../assets/images/wallet/x-logo.png")}
          style={styles.iconSquare}
          contentFit="cover"
        />
      ),
      onPress: () => {
        void Linking.openURL("https://x.com/loyal_hq");
      },
    },
  ];

  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  activeIndexRef.current = activeIndex;

  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animatingRef = useRef(false);

  const animateSlide = useCallback(
    (direction: "up" | "down", newIndex: number) => {
      animatingRef.current = true;
      const from = direction === "up" ? 24 : -24;
      opacity.setValue(0);
      translateY.setValue(from);
      setActiveIndex(newIndex);
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: SLIDE_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: SLIDE_DURATION,
          useNativeDriver: true,
        }),
      ]).start(() => {
        animatingRef.current = false;
      });
    },
    [translateY, opacity]
  );

  const startAutoRotate = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (banners.length <= 1) return;
    intervalRef.current = setInterval(() => {
      const next = (activeIndexRef.current + 1) % banners.length;
      animateSlide("up", next);
    }, AUTO_ROTATE_MS);
  }, [banners.length, animateSlide]);

  useEffect(() => {
    startAutoRotate();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [startAutoRotate]);

  const goTo = useCallback(
    (index: number, direction: "up" | "down") => {
      const count = banners.length;
      if (count === 0) return;
      const wrapped = ((index % count) + count) % count;
      if (wrapped === activeIndexRef.current) return;
      if (process.env.EXPO_OS !== "web") {
        void Haptics.selectionAsync();
      }
      animateSlide(direction, wrapped);
      startAutoRotate();
    },
    [banners.length, animateSlide, startAutoRotate]
  );

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
      onPanResponderGrant: () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      },
      onPanResponderMove: (_, g) => {
        if (animatingRef.current) return;
        translateY.setValue(g.dy * 0.5);
      },
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dy) > SWIPE_THRESHOLD) {
          const next =
            g.dy < 0 ? activeIndexRef.current + 1 : activeIndexRef.current - 1;
          goTo(next, g.dy < 0 ? "up" : "down");
        } else {
          Animated.timing(translateY, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }).start();
          startAutoRotate();
        }
      },
      onPanResponderTerminate: () => {
        Animated.timing(translateY, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }).start();
        startAutoRotate();
      },
    })
  ).current;

  const handlePress = useCallback((banner: Banner) => {
    if (process.env.EXPO_OS !== "web") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    banner.onPress();
  }, []);

  if (banners.length === 0) return null;

  const active = banners[activeIndex];

  return (
    <View style={styles.card}>
      <Animated.View
        style={[styles.content, { opacity, transform: [{ translateY }] }]}
        {...panResponder.panHandlers}
      >
        <Pressable onPress={() => handlePress(active)} style={styles.pressArea}>
          <View>{active.icon}</View>
          <Text style={styles.title} numberOfLines={3}>
            {active.title}
          </Text>
        </Pressable>
      </Animated.View>

      {banners.length > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {banners.map((b, i) => (
            <View
              key={b.id}
              style={[
                styles.dot,
                { backgroundColor: i === activeIndex ? BRAND_RED : DOT_DIM },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(0, 0, 0, 0.03)",
    padding: 16,
    overflow: "hidden",
  },
  content: {
    flex: 1,
  },
  pressArea: {
    flex: 1,
    justifyContent: "space-between",
  },
  iconSquare: {
    width: 36,
    height: 36,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  title: {
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    lineHeight: 18,
    color: TITLE_COLOR,
    maxWidth: 116,
  },
  dots: {
    position: "absolute",
    right: 6,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
