import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  type ImageSourcePropType,
  PanResponder,
  Image as RNImage,
} from "react-native";

import { Pressable, Text, View } from "@/tw";

import {
  getCachedDismissedBannerIds,
  loadDismissedBannerIds,
  saveDismissedBannerIds,
} from "./banner-dismissals";

const banner2 = require("../../../assets/images/banners/banner2.png") as ImageSourcePropType;
const banner3 = require("../../../assets/images/banners/banner3.png") as ImageSourcePropType;

type Banner = {
  id: string;
  title: string;
  cta: string;
  image: ImageSourcePropType;
  onPress: () => void;
};

const SWIPE_THRESHOLD = 30;
const SLIDE_DURATION = 180;
const AUTO_ROTATE_INTERVAL = 3000;
const CARD_HEIGHT = 112;

function getAllBanners(): Banner[] {
  return [
    {
      id: "view-community-summary",
      title: "View your community summaries and stay up to date",
      cta: "View Summaries",
      image: banner3,
      onPress: () => {
        // Navigation to summaries tab will be wired when tab navigator is ready
      },
    },
    {
      id: "emoji-status",
      title: "Set Emoji Status and show your loyalty",
      cta: "Set",
      image: banner2,
      onPress: () => {
        // Emoji status not available in mobile
      },
    },
  ];
}

function BannerCard({
  banner,
  onDismiss,
}: {
  banner: Banner;
  onDismiss: (id: string) => void;
}) {
  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    banner.onPress();
  }, [banner]);

  const handleDismiss = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onDismiss(banner.id);
  }, [banner.id, onDismiss]);

  return (
    <View
      className="overflow-hidden rounded-[20px]"
      style={{ height: CARD_HEIGHT }}
    >
      {/* Background: gray base + red gradient overlay (matches web CSS) */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "#f2f2f7",
        }}
      />
      <LinearGradient
        colors={["rgba(249, 54, 60, 0)", "rgba(249, 54, 60, 0.14)"]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />

      {/* Content area - text on left, image space on right */}
      <View className="flex-1 justify-between p-4" style={{ paddingRight: 172 }}>
        <Text
          className="text-[17px] font-medium text-black"
          style={{ letterSpacing: -0.187, lineHeight: 22 }}
          numberOfLines={2}
        >
          {banner.title}
        </Text>

        <Pressable
          className="self-start rounded-[20px] px-3 py-2"
          style={{ backgroundColor: "#F9363C" }}
          onPress={handlePress}
        >
          <Text className="text-[15px] text-white" style={{ lineHeight: 20 }}>
            {banner.cta}
          </Text>
        </Pressable>
      </View>

      {/* Mascot image on the right */}
      <View
        className="absolute bottom-0 right-0"
        style={{ width: 172, height: CARD_HEIGHT }}
        pointerEvents="none"
      >
        <RNImage
          source={banner.image}
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: "85%",
            height: "100%",
          }}
          resizeMode="contain"
        />
      </View>

      {/* Close button */}
      <Pressable
        className="absolute right-[10px] top-[10px] z-10 h-7 w-7 items-center justify-center rounded-full"
        style={{ backgroundColor: "rgba(0, 0, 0, 0.06)" }}
        onPress={handleDismiss}
      >
        <X size={14} color="rgba(60, 60, 67, 0.6)" strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}

function DotIndicators({
  count,
  activeIndex,
}: {
  count: number;
  activeIndex: number;
}) {
  if (count <= 1) return null;

  return (
    <View className="mt-2 flex-row items-center justify-center gap-2">
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          className="h-2 w-2 rounded-full"
          style={{
            backgroundColor:
              i === activeIndex ? "#F9363C" : "rgba(60, 60, 67, 0.18)",
          }}
        />
      ))}
    </View>
  );
}

export function BannerCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(
    () => getCachedDismissedBannerIds() ?? new Set(),
  );

  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const autoRotateRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  useEffect(() => {
    const ids = loadDismissedBannerIds();
    setDismissedIds(ids);
  }, []);

  const visibleBanners = useMemo(() => {
    const all = getAllBanners();
    return all.filter((b) => !dismissedIds.has(b.id));
  }, [dismissedIds]);

  const visibleBannersRef = useRef(visibleBanners);
  visibleBannersRef.current = visibleBanners;

  const animateSlide = useCallback(
    (direction: "left" | "right", newIndex: number) => {
      const from = direction === "left" ? 40 : -40;

      // Slide out + fade
      opacity.setValue(0);
      translateX.setValue(from);
      setActiveIndex(newIndex);

      // Slide in
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
      ]).start();
    },
    [translateX, opacity],
  );

  const goTo = useCallback(
    (index: number, direction: "left" | "right") => {
      const count = visibleBannersRef.current.length;
      if (count === 0) return;
      const wrapped = ((index % count) + count) % count;
      if (wrapped === activeIndexRef.current) return;

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      animateSlide(direction, wrapped);
    },
    [animateSlide],
  );

  // Auto-rotate
  const startAutoRotate = useCallback(() => {
    if (autoRotateRef.current) clearInterval(autoRotateRef.current);
    if (visibleBannersRef.current.length <= 1) return;

    autoRotateRef.current = setInterval(() => {
      const count = visibleBannersRef.current.length;
      if (count <= 1) return;
      const next = (activeIndexRef.current + 1) % count;
      animateSlide("left", next);
    }, AUTO_ROTATE_INTERVAL);
  }, [animateSlide]);

  useEffect(() => {
    startAutoRotate();
    return () => {
      if (autoRotateRef.current) clearInterval(autoRotateRef.current);
    };
  }, [startAutoRotate, visibleBanners.length]);

  // Pan responder for swipe gestures
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only capture horizontal swipes
        return (
          Math.abs(gestureState.dx) > 10 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2
        );
      },
      onPanResponderMove: (_, gestureState) => {
        translateX.setValue(gestureState.dx * 0.5);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (Math.abs(gestureState.dx) > SWIPE_THRESHOLD) {
          // Stop auto-rotate on manual swipe, then restart
          if (autoRotateRef.current) clearInterval(autoRotateRef.current);

          if (gestureState.dx < 0) {
            goTo(activeIndexRef.current + 1, "left");
          } else {
            goTo(activeIndexRef.current - 1, "right");
          }

          // Restart auto-rotate after manual swipe
          startAutoRotate();
        } else {
          // Snap back
          Animated.timing(translateX, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  const handleDismiss = useCallback(
    (id: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const next = new Set(dismissedIds);
      next.add(id);
      setDismissedIds(next);
      saveDismissedBannerIds(next);

      // Stop auto-rotate
      if (autoRotateRef.current) clearInterval(autoRotateRef.current);

      // Adjust active index
      const remaining = visibleBanners.filter((b) => b.id !== id).length;
      if (remaining === 0) {
        setActiveIndex(0);
      } else if (activeIndex >= remaining) {
        setActiveIndex(remaining - 1);
      }
    },
    [dismissedIds, visibleBanners, activeIndex],
  );

  if (visibleBanners.length === 0) return null;

  const banner = visibleBanners[activeIndex] ?? visibleBanners[0];
  if (!banner) return null;

  return (
    <View className="mt-4 px-4">
      <Animated.View
        style={{ transform: [{ translateX }], opacity }}
        {...panResponder.panHandlers}
      >
        <BannerCard banner={banner} onDismiss={handleDismiss} />
      </Animated.View>
      <DotIndicators count={visibleBanners.length} activeIndex={activeIndex} />
    </View>
  );
}
