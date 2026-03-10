import * as Haptics from "expo-haptics";
import { X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, FlatList } from "react-native";

import { Pressable, Text, View } from "@/tw";

import {
  getCachedDismissedBannerIds,
  loadDismissedBannerIds,
  saveDismissedBannerIds,
} from "./banner-dismissals";

type Banner = {
  id: string;
  title: string;
  cta: string;
  bgColor: string;
  onPress: () => void;
};

const CARD_MARGIN = 16;
const AUTO_ROTATE_INTERVAL = 3000;
const CARD_HEIGHT = 112;

const screenWidth = Dimensions.get("window").width;
const cardWidth = screenWidth - CARD_MARGIN * 2;

function getAllBanners(): Banner[] {
  return [
    {
      id: "view-community-summary",
      title: "View your community summaries and stay up to date",
      cta: "View Summaries",
      bgColor: "#F5F5F5",
      onPress: () => {
        // Navigation to summaries tab will be wired when tab navigator is ready
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
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    banner.onPress();
  }, [banner]);

  const handleDismiss = useCallback(() => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onDismiss(banner.id);
  }, [banner.id, onDismiss]);

  return (
    <View
      className="justify-between overflow-hidden rounded-[20px] p-4"
      style={{
        width: cardWidth,
        height: CARD_HEIGHT,
        backgroundColor: banner.bgColor,
      }}
    >
      <Pressable
        className="absolute right-3 top-3 z-10 h-7 w-7 items-center justify-center rounded-full bg-black/10"
        onPress={handleDismiss}
      >
        <X size={14} color="#000000" strokeWidth={2.5} />
      </Pressable>

      <Text className="pr-10 text-[17px] font-semibold text-black" numberOfLines={2}>
        {banner.title}
      </Text>

      <Pressable
        className="self-start rounded-full px-4 py-1.5"
        style={{ backgroundColor: "#F9363C" }}
        onPress={handlePress}
      >
        <Text className="text-[13px] font-semibold text-white">{banner.cta}</Text>
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
    <View className="mt-2 flex-row items-center justify-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          className="h-1.5 w-1.5 rounded-full"
          style={{
            backgroundColor: i === activeIndex ? "#F9363C" : "#D4D4D4",
          }}
        />
      ))}
    </View>
  );
}

export function BannerCarousel() {
  const flatListRef = useRef<FlatList<Banner>>(null);
  const autoRotateRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(
    () => getCachedDismissedBannerIds() ?? new Set(),
  );

  useEffect(() => {
    const ids = loadDismissedBannerIds();
    setDismissedIds(ids);
  }, []);

  const visibleBanners = useMemo(() => {
    const all = getAllBanners();
    return all.filter((b) => !dismissedIds.has(b.id));
  }, [dismissedIds]);

  const handleDismiss = useCallback(
    (id: string) => {
      const next = new Set(dismissedIds);
      next.add(id);
      setDismissedIds(next);
      saveDismissedBannerIds(next);
    },
    [dismissedIds],
  );

  // Auto-rotate
  useEffect(() => {
    if (visibleBanners.length <= 1) return;

    autoRotateRef.current = setInterval(() => {
      setActiveIndex((prev) => {
        const next = (prev + 1) % visibleBanners.length;
        flatListRef.current?.scrollToIndex({ index: next, animated: true });
        return next;
      });
    }, AUTO_ROTATE_INTERVAL);

    return () => {
      if (autoRotateRef.current) clearInterval(autoRotateRef.current);
    };
  }, [visibleBanners.length]);

  const handleScrollEnd = useCallback(
    (e: { nativeEvent: { contentOffset: { x: number } } }) => {
      const index = Math.round(e.nativeEvent.contentOffset.x / cardWidth);
      setActiveIndex(index);

      // Reset auto-rotate timer on manual scroll
      if (autoRotateRef.current) {
        clearInterval(autoRotateRef.current);
      }
      if (visibleBanners.length > 1) {
        autoRotateRef.current = setInterval(() => {
          setActiveIndex((prev) => {
            const next = (prev + 1) % visibleBanners.length;
            flatListRef.current?.scrollToIndex({ index: next, animated: true });
            return next;
          });
        }, AUTO_ROTATE_INTERVAL);
      }
    },
    [visibleBanners.length],
  );

  if (visibleBanners.length === 0) return null;

  return (
    <View className="mt-4">
      <FlatList
        ref={flatListRef}
        data={visibleBanners}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: CARD_MARGIN }}
        onMomentumScrollEnd={handleScrollEnd}
        renderItem={({ item }) => (
          <BannerCard banner={item} onDismiss={handleDismiss} />
        )}
        getItemLayout={(_, index) => ({
          length: cardWidth,
          offset: cardWidth * index,
          index,
        })}
      />
      <DotIndicators count={visibleBanners.length} activeIndex={activeIndex} />
    </View>
  );
}
