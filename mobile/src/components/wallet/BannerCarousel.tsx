import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Linking,
  PanResponder,
  StyleSheet,
} from "react-native";

import { Pressable, Text, View } from "@/tw";
import { Image } from "@/tw/image";

const AUTO_ROTATE_MS = 4000;
const SLIDE_DURATION = 220;
const SWIPE_THRESHOLD = 36;
const BRAND_RED = "#f9363c";

type Banner = {
  id: string;
  title: string;
  cta: string;
  image: ReturnType<typeof require>;
  onPress: () => void;
};

type Props = {
  onShield: () => void;
};

export function BannerCarousel({ onShield }: Props) {
  const banners: Banner[] = [
    {
      id: "earn",
      title: "Earn up to 8% APY on shielded dollars",
      cta: "Shield Now",
      image: require("../../../assets/images/banners/banner-earn.png"),
      onPress: onShield,
    },
    {
      id: "follow",
      title: "Follow Loyal on X",
      cta: "Follow",
      image: require("../../../assets/images/banners/banner-follow.png"),
      onPress: () => {
        void Linking.openURL("https://x.com/loyal_hq");
      },
    },
  ];

  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  activeIndexRef.current = activeIndex;

  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animatingRef = useRef(false);

  const animateSlide = useCallback(
    (direction: "left" | "right", newIndex: number) => {
      animatingRef.current = true;
      const from = direction === "left" ? 40 : -40;
      opacity.setValue(0);
      translateX.setValue(from);
      setActiveIndex(newIndex);
      Animated.parallel([
        Animated.timing(translateX, {
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
    [translateX, opacity],
  );

  const startAutoRotate = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (banners.length <= 1) return;
    intervalRef.current = setInterval(() => {
      const next = (activeIndexRef.current + 1) % banners.length;
      animateSlide("left", next);
    }, AUTO_ROTATE_MS);
  }, [banners.length, animateSlide]);

  useEffect(() => {
    startAutoRotate();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [startAutoRotate]);

  const goTo = useCallback(
    (index: number, direction: "left" | "right") => {
      const count = banners.length;
      if (count === 0) return;
      const wrapped = ((index % count) + count) % count;
      if (wrapped === activeIndexRef.current) return;
      if (process.env.EXPO_OS !== "web") {
        Haptics.selectionAsync();
      }
      animateSlide(direction, wrapped);
      startAutoRotate();
    },
    [banners.length, animateSlide, startAutoRotate],
  );

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
      onPanResponderGrant: () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      },
      onPanResponderMove: (_, g) => {
        if (animatingRef.current) return;
        translateX.setValue(g.dx * 0.5);
      },
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > SWIPE_THRESHOLD) {
          const next =
            g.dx < 0
              ? activeIndexRef.current + 1
              : activeIndexRef.current - 1;
          goTo(next, g.dx < 0 ? "left" : "right");
        } else {
          Animated.timing(translateX, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }).start();
          startAutoRotate();
        }
      },
      onPanResponderTerminate: () => {
        Animated.timing(translateX, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }).start();
        startAutoRotate();
      },
    }),
  ).current;

  const handleCta = useCallback((banner: Banner) => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    banner.onPress();
  }, []);

  const handleDotPress = useCallback(
    (index: number) => {
      const direction = index > activeIndexRef.current ? "left" : "right";
      goTo(index, direction);
    },
    [goTo],
  );

  if (banners.length === 0) return null;

  const active = banners[activeIndex];

  return (
    <View style={styles.wrapper}>
      <Animated.View
        style={[styles.cardClip, { transform: [{ translateX }], opacity }]}
        {...panResponder.panHandlers}
      >
        <View style={styles.solidBg} />
        <LinearGradient
          colors={["rgba(249,54,60,0)", "rgba(249,54,60,0.14)"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.gradientFill}
        />
        <View style={styles.row}>
          <View style={styles.textColumn}>
            <Text style={styles.title} numberOfLines={2}>
              {active.title}
            </Text>
            <Pressable
              onPress={() => handleCta(active)}
              style={styles.ctaButton}
              hitSlop={6}
            >
              <Text style={styles.ctaText}>{active.cta}</Text>
            </Pressable>
          </View>
          <View style={styles.imageWrap} pointerEvents="none">
            <Image
              source={active.image}
              style={styles.image}
              contentFit="contain"
              contentPosition="right bottom"
            />
          </View>
        </View>
      </Animated.View>

      {banners.length > 1 ? (
        <View style={styles.dotsRow}>
          {banners.map((b, i) => (
            <Pressable
              key={b.id}
              onPress={() => handleDotPress(i)}
              hitSlop={10}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    i === activeIndex ? BRAND_RED : "rgba(0,0,0,0.12)",
                },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 16,
  },
  cardClip: {
    borderRadius: 20,
    overflow: "hidden",
    height: 96,
  },
  solidBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#f5f5f5",
  },
  gradientFill: {
    ...StyleSheet.absoluteFillObject,
  },
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
  },
  textColumn: {
    flex: 1,
    paddingVertical: 12,
    paddingLeft: 16,
    justifyContent: "space-between",
    minWidth: 0,
    zIndex: 1,
  },
  title: {
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.187,
    color: "#000",
    maxWidth: 180,
  },
  ctaButton: {
    alignSelf: "flex-start",
    backgroundColor: BRAND_RED,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  ctaText: {
    fontFamily: "Geist_400Regular",
    fontSize: 13,
    lineHeight: 18,
    color: "#fff",
  },
  imageWrap: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 140,
    height: "100%",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    paddingTop: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
