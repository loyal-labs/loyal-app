import type { ChatSummary, Topic } from "@loyal-labs/shared";

import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams } from "expo-router";
import Logo from "../../assets/images/logo.svg";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  View as RNView,
  Text as RNText,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import {
  getAvatarColor,
  getFirstLetter,
} from "@/components/summaries/avatar-utils";
import { DatePicker } from "@/components/summaries/DatePicker";
import {
  getAvailableDates,
  getMessageCountForDate,
  getTopicsForDate,
  groupSummariesByDate,
  toDateKey,
} from "@/components/summaries/summary-utils";
import { TopicCard } from "@/components/summaries/TopicCard";
import { fetchSummariesByGroup } from "@/services/api";
import { Pressable, Text, View } from "@/tw";
import { Image } from "@/tw/image";

const SWIPE_THRESHOLD = 50;
const DAMPING = 0.4;
const BOUNDARY_DAMPING = 0.15;
const SLIDE_MS = 180;

export default function SummaryFeedScreen() {
  const { groupChatId } = useLocalSearchParams<{ groupChatId: string }>();
  const { width: screenWidth } = useWindowDimensions();

  const [summaries, setSummaries] = useState<ChatSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!groupChatId) return;
    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        setError(null);
        const data = await fetchSummariesByGroup(groupChatId);
        if (!cancelled) setSummaries(data);
      } catch (err) {
        if (!cancelled) setError("Failed to load summaries");
        console.error(err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupChatId]);

  const groupTitle = useMemo(
    () => (summaries.length > 0 ? summaries[0].title : "Summary"),
    [summaries],
  );
  const summariesByDate = useMemo(
    () => groupSummariesByDate(summaries),
    [summaries],
  );
  const availableDates = useMemo(
    () => getAvailableDates(summaries),
    [summaries],
  );

  const [selectedDate, setSelectedDate] = useState<string>(() =>
    toDateKey(new Date().toISOString()),
  );

  useEffect(() => {
    if (availableDates.length > 0 && !availableDates.includes(selectedDate)) {
      setSelectedDate(availableDates[0]);
    }
  }, [availableDates, selectedDate]);

  const messageCount = useMemo(
    () => getMessageCountForDate(summariesByDate, selectedDate),
    [summariesByDate, selectedDate],
  );
  const topics = useMemo(
    () => getTopicsForDate(summariesByDate, selectedDate),
    [summariesByDate, selectedDate],
  );
  const { prevTopics, nextTopics } = useMemo(() => {
    const i = availableDates.indexOf(selectedDate);
    const pDate = i < availableDates.length - 1 ? availableDates[i + 1] : null;
    const nDate = i > 0 ? availableDates[i - 1] : null;
    return {
      prevTopics: pDate ? getTopicsForDate(summariesByDate, pDate) : [],
      nextTopics: nDate ? getTopicsForDate(summariesByDate, nDate) : [],
    };
  }, [availableDates, selectedDate, summariesByDate]);

  // ── Slide transition (dual-layer, matching web app) ──
  // Keep oldTopics synced with current topics so the overlay is ready for next swipe.
  // Skip sync during transitions to avoid overwriting the frozen old content.
  const [oldTopics, setOldTopics] = useState<Topic[]>([]);
  const isTransitioning = useRef(false);
  useEffect(() => {
    if (!isTransitioning.current) {
      setOldTopics(topics);
    }
  }, [topics]);

  const slideInX = useSharedValue(0);
  const slideOutX = useSharedValue(0);
  const overlayVisible = useSharedValue(0); // 0 = hidden, 1 = visible

  const newContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slideInX.value }],
    opacity: 1 - 0.5 * (Math.abs(slideInX.value) / screenWidth),
  }));
  const oldContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slideOutX.value }],
    opacity: overlayVisible.value,
  }));
  // Hide peek panels when overlay is active (driven by shared value, not React state)
  const peekStyle = useAnimatedStyle(() => ({
    opacity: overlayVisible.value === 0 ? 0.5 : 0,
  }));

  const handleDateSelect = useCallback(
    (date: string) => {
      if (date === selectedDate) return;
      const dir = date > selectedDate ? "left" : "right";
      isTransitioning.current = true;
      setOldTopics(topics);
      setSelectedDate(date);

      setTimeout(() => {
        isTransitioning.current = false;
      }, SLIDE_MS + 50);

      overlayVisible.value = 1;
      slideInX.value = dir === "left" ? screenWidth : -screenWidth;
      slideInX.value = withTiming(0, { duration: SLIDE_MS }, () => {
        overlayVisible.value = 0;
      });
      slideOutX.value = 0;
      slideOutX.value = withTiming(
        dir === "left" ? -screenWidth : screenWidth,
        { duration: SLIDE_MS },
      );
    },
    [selectedDate, topics, screenWidth],
  );

  const handleTodayPress = useCallback(() => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    handleDateSelect(toDateKey(new Date().toISOString()));
  }, [handleDateSelect]);

  // ── Drag gesture (peek + commit) ──
  const translateX = useSharedValue(0);
  const canGoPrev = useSharedValue(false);
  const canGoNext = useSharedValue(false);

  useEffect(() => {
    const idx = availableDates.indexOf(selectedDate);
    canGoPrev.value = idx >= 0 && idx < availableDates.length - 1;
    canGoNext.value = idx > 0;
  }, [availableDates, selectedDate]);

  // Only handles React state — no animations (those start in the worklet)
  const commitSwipeState = useCallback(
    (direction: "prev" | "next") => {
      const idx = availableDates.indexOf(selectedDate);
      if (process.env.EXPO_OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }

      isTransitioning.current = true;
      setOldTopics(topics);

      let newDate: string | undefined;
      if (direction === "prev" && idx < availableDates.length - 1) {
        newDate = availableDates[idx + 1];
      } else if (direction === "next" && idx > 0) {
        newDate = availableDates[idx - 1];
      }
      if (newDate) setSelectedDate(newDate);

      setTimeout(() => {
        isTransitioning.current = false;
      }, SLIDE_MS + 50);
    },
    [availableDates, selectedDate, topics],
  );

  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-20, 20])
    .onUpdate((e) => {
      "worklet";
      const raw = e.translationX;
      const right = raw > 0;
      const left = raw < 0;
      if ((right && !canGoPrev.value) || (left && !canGoNext.value)) {
        translateX.value = raw * BOUNDARY_DAMPING;
      } else {
        translateX.value = raw * DAMPING;
      }
    })
    .onEnd((e) => {
      "worklet";
      const raw = e.translationX;
      const offset = translateX.value;
      const sw = screenWidth;
      const dur = SLIDE_MS;

      if (raw > SWIPE_THRESHOLD && canGoPrev.value) {
        // All animations start immediately on UI thread — no React delay
        overlayVisible.value = 1;
        translateX.value = withTiming(0, { duration: dur });
        slideOutX.value = offset;
        slideOutX.value = withTiming(sw, { duration: dur });
        slideInX.value = -sw;
        slideInX.value = withTiming(0, { duration: dur }, () => {
          overlayVisible.value = 0;
        });
        runOnJS(commitSwipeState)("prev");
      } else if (raw < -SWIPE_THRESHOLD && canGoNext.value) {
        overlayVisible.value = 1;
        translateX.value = withTiming(0, { duration: dur });
        slideOutX.value = offset;
        slideOutX.value = withTiming(-sw, { duration: dur });
        slideInX.value = sw;
        slideInX.value = withTiming(0, { duration: dur }, () => {
          overlayVisible.value = 0;
        });
        runOnJS(commitSwipeState)("next");
      } else {
        translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // ── Render ──
  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ headerTitle: () => <Logo width={78} height={23} /> }} />
        <View className="flex-1 items-center justify-center bg-white">
          <ActivityIndicator />
        </View>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Stack.Screen options={{ headerTitle: () => <Logo width={78} height={23} /> }} />
        <View className="flex-1 items-center justify-center bg-white">
          <Text className="text-black/50">{error}</Text>
        </View>
      </>
    );
  }

  const groupPhoto =
    summaries[0]?.photoUrl ??
    (summaries[0]?.photoBase64
      ? `data:${summaries[0].photoMimeType ?? "image/jpeg"};base64,${summaries[0].photoBase64}`
      : null);
  const avatarColor = getAvatarColor(groupTitle);
  const firstLetter = getFirstLetter(groupTitle);

  return (
    <>
      <Stack.Screen options={{ headerTitle: () => <Logo width={78} height={23} /> }} />
      <Animated.ScrollView
        style={{ flex: 1, backgroundColor: "#fff" }}
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* Group info header */}
        <View className="px-4 pt-4 pb-2 flex-row items-center gap-3">
          {groupPhoto ? (
            <Image
              source={{ uri: groupPhoto }}
              className="w-11 h-11 rounded-full object-cover"
            />
          ) : (
            <View
              className="w-11 h-11 rounded-full items-center justify-center"
              style={{ backgroundColor: avatarColor }}
            >
              <Text className="text-base font-medium text-white">
                {firstLetter}
              </Text>
            </View>
          )}
          <View className="flex-1">
            <Text
              numberOfLines={1}
              style={{
                fontFamily: "Geist_500Medium",
                fontSize: 17,
                lineHeight: 22,
                color: "#000",
              }}
            >
              {groupTitle}
            </Text>
            <Text
              style={{
                fontFamily: "Geist_400Regular",
                fontSize: 15,
                lineHeight: 20,
                color: "rgba(60,60,67,0.6)",
                marginTop: 2,
              }}
            >
              {messageCount > 0
                ? `Summary of ${messageCount.toLocaleString()} messages`
                : "No messages"}
            </Text>
          </View>
          <Pressable
            className="rounded-full px-4 active:opacity-70"
            style={{
              backgroundColor: "rgba(249,54,60,0.14)",
              height: 44,
              justifyContent: "center",
            }}
            onPress={handleTodayPress}
          >
            <Text
              style={{
                fontFamily: "Geist_500Medium",
                fontSize: 17,
                lineHeight: 22,
                color: "#000",
              }}
            >
              Today
            </Text>
          </Pressable>
        </View>

        {/* Date picker */}
        <DatePicker
          availableDates={availableDates}
          selectedDate={selectedDate}
          onDateSelect={handleDateSelect}
        />

        {/* Swipeable content area */}
        <GestureDetector gesture={swipeGesture}>
          <Animated.View style={{ overflow: "hidden", minHeight: 200 }}>
            {/* Drag wrapper — moves content + peek panels with finger */}
            <Animated.View style={dragStyle}>
              {/* Prev day peek (left of content) — hidden via shared value during slide */}
              {prevTopics.length > 0 && (
                <Animated.View
                  style={[
                    {
                      position: "absolute",
                      top: 0,
                      right: "100%" as any,
                      width: screenWidth,
                      paddingHorizontal: 16,
                      gap: 12,
                    },
                    peekStyle,
                  ]}
                >
                  {prevTopics.map((topic) => (
                    <TopicCard key={`prev-${topic.id}`} topic={topic} />
                  ))}
                </Animated.View>
              )}

              {/* Main content — always has newContentStyle (no-op when slideInX=0) */}
              <Animated.View
                style={[
                  { paddingHorizontal: 16, gap: 12, paddingBottom: 32 },
                  newContentStyle,
                ]}
              >
                {topics.length > 0 ? (
                  topics.map((topic) => (
                    <TopicCard key={topic.id} topic={topic} />
                  ))
                ) : (
                  <RNView
                    style={{ alignItems: "center", paddingVertical: 64 }}
                  >
                    <RNText
                      style={{
                        fontFamily: "Geist_400Regular",
                        fontSize: 15,
                        color: "rgba(0,0,0,0.6)",
                      }}
                    >
                      Summary for today is being created...
                    </RNText>
                  </RNView>
                )}
              </Animated.View>

              {/* Next day peek (right of content) */}
              {nextTopics.length > 0 && (
                <Animated.View
                  style={[
                    {
                      position: "absolute",
                      top: 0,
                      left: "100%" as any,
                      width: screenWidth,
                      paddingHorizontal: 16,
                      gap: 12,
                    },
                    peekStyle,
                  ]}
                >
                  {nextTopics.map((topic) => (
                    <TopicCard key={`next-${topic.id}`} topic={topic} />
                  ))}
                </Animated.View>
              )}
            </Animated.View>

            {/* Old content overlay — always rendered, visibility via shared value */}
            <Animated.View
              style={[
                {
                  ...StyleSheet.absoluteFillObject,
                  backgroundColor: "#fff",
                  paddingHorizontal: 16,
                  gap: 12,
                  paddingBottom: 32,
                },
                oldContentStyle,
              ]}
              pointerEvents="none"
            >
              {oldTopics.map((topic) => (
                <TopicCard key={`old-${topic.id}`} topic={topic} />
              ))}
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </Animated.ScrollView>
    </>
  );
}
