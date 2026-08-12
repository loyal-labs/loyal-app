import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

type DatePickerProps = {
  availableDates: string[];
  selectedDate: string;
  onDateSelect: (date: string) => void;
};

const ITEM_WIDTH = 56;

function getMonthAbbr(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
}

function getMonthKey(dateStr: string): string {
  return dateStr.substring(0, 7);
}

function getDayNumber(dateStr: string): number {
  return new Date(dateStr + "T12:00:00").getDate();
}

function generateDateRange(pastDays = 30, futureDays = 7): string[] {
  const dates: string[] = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  for (let i = pastDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }
  for (let i = 1; i <= futureDays; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

function isFutureDate(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr + "T00:00:00") > today;
}

export function DatePicker({
  availableDates,
  selectedDate,
  onDateSelect,
}: DatePickerProps) {
  const { width: screenWidth } = useWindowDimensions();
  const flatListRef = useRef<FlatList>(null);
  const layoutReady = useRef(false);
  const isUserScrolling = useRef(false);

  const availableDateSet = useMemo(
    () => new Set(availableDates),
    [availableDates],
  );
  const todayKey = useMemo(() => new Date().toISOString().split("T")[0], []);
  const dates = useMemo(() => generateDateRange(), []);

  const selectedMonthKey = getMonthKey(selectedDate);

  // Month labels: selected month travels with selected date,
  // earlier months on their last date, later months on their first
  const monthLabelDates = useMemo(() => {
    const labels = new Map<string, string>();
    const monthGroups = new Map<string, string[]>();

    for (const date of dates) {
      const mk = getMonthKey(date);
      if (!monthGroups.has(mk)) monthGroups.set(mk, []);
      monthGroups.get(mk)!.push(date);
    }

    for (const [mk, monthDates] of monthGroups) {
      if (mk === selectedMonthKey) {
        labels.set(selectedDate, getMonthAbbr(selectedDate));
      } else if (mk < selectedMonthKey) {
        const last = monthDates[monthDates.length - 1];
        labels.set(last, getMonthAbbr(last));
      } else {
        labels.set(monthDates[0], getMonthAbbr(monthDates[0]));
      }
    }

    return labels;
  }, [dates, selectedDate, selectedMonthKey]);

  // Scroll to center the selected date
  useEffect(() => {
    const index = dates.indexOf(selectedDate);
    if (index === -1) return;

    const timer = setTimeout(
      () => {
        flatListRef.current?.scrollToOffset({
          offset: index * ITEM_WIDTH,
          animated: layoutReady.current,
        });
        layoutReady.current = true;
      },
      layoutReady.current ? 10 : 50,
    );
    return () => clearTimeout(timer);
  }, [selectedDate, dates]);

  const handleDatePress = useCallback(
    (date: string) => {
      const hasData = availableDateSet.has(date);
      const isToday = date === todayKey;
      const isFuture = isFutureDate(date);

      if (isFuture || (!hasData && !isToday)) {
        if (process.env.EXPO_OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
        return;
      }

      if (date === selectedDate) return;

      if (process.env.EXPO_OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      onDateSelect(date);
    },
    [availableDateSet, selectedDate, onDateSelect, todayKey],
  );

  // When scroll settles, select the centered date (or snap back from future)
  const handleScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!isUserScrolling.current) return;
      isUserScrolling.current = false;

      const offset = e.nativeEvent.contentOffset.x;
      const index = Math.round(offset / ITEM_WIDTH);
      const clamped = Math.max(0, Math.min(index, dates.length - 1));
      const date = dates[clamped];
      if (!date || date === selectedDate) return;

      const isFuture = isFutureDate(date);
      const hasData = availableDateSet.has(date);
      const isToday = date === todayKey;
      const isSelectable = !isFuture && (hasData || isToday);

      if (isSelectable) {
        if (process.env.EXPO_OS !== "web") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        onDateSelect(date);
      } else {
        // Scrolled to a non-selectable date — find the closest selectable one
        // searching backwards (towards today/past)
        let fallbackDate: string | null = null;
        for (let i = clamped; i >= 0; i--) {
          const d = dates[i];
          const dFuture = isFutureDate(d);
          if (!dFuture && (availableDateSet.has(d) || d === todayKey)) {
            fallbackDate = d;
            break;
          }
        }
        if (fallbackDate && fallbackDate !== selectedDate) {
          onDateSelect(fallbackDate);
        } else {
          // Snap back to current selection
          const selIdx = dates.indexOf(selectedDate);
          if (selIdx !== -1) {
            flatListRef.current?.scrollToOffset({
              offset: selIdx * ITEM_WIDTH,
              animated: true,
            });
          }
        }
      }
    },
    [dates, availableDateSet, selectedDate, onDateSelect, todayKey],
  );

  const renderItem = useCallback(
    ({ item: date }: { item: string }) => {
      const isSelected = date === selectedDate;
      const hasData = availableDateSet.has(date);
      const isFuture = isFutureDate(date);
      const isToday = date === todayKey;
      const isSelectable = !isFuture && (hasData || isToday);
      const monthLabel = monthLabelDates.get(date);
      const isActiveMonth = getMonthKey(date) === selectedMonthKey;

      return (
        <Pressable
          onPress={() => handleDatePress(date)}
          style={{
            width: ITEM_WIDTH,
            height: 70,
            alignItems: "center",
          }}
        >
          {/* Month label row */}
          <View style={{ height: 20, justifyContent: "flex-start" }}>
            {monthLabel ? (
              <Text
                style={{
                  fontFamily: "Geist_600SemiBold",
                  fontSize: 13,
                  color: isActiveMonth ? "#000" : "rgba(60,60,67,0.6)",
                }}
              >
                {monthLabel}
              </Text>
            ) : null}
          </View>

          {/* Red dot (6px) */}
          <View
            style={{
              height: 6,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {hasData && !isFuture ? (
              <View
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: "#f9363c",
                }}
              />
            ) : null}
          </View>

          {/* Date circle (40px) — using overflow hidden with borderRadius */}
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              overflow: "hidden",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: isSelected
                ? "rgba(249,54,60,0.14)"
                : "transparent",
            }}
          >
            <Text
              style={{
                fontFamily: "Geist_500Medium",
                fontSize: 17,
                textAlign: "center",
                color: isSelected
                  ? "#000"
                  : isSelectable
                    ? "rgba(60,60,67,0.6)"
                    : "rgba(60,60,67,0.3)",
              }}
            >
              {getDayNumber(date)}
            </Text>
          </View>
        </Pressable>
      );
    },
    [
      selectedDate,
      availableDateSet,
      todayKey,
      handleDatePress,
      monthLabelDates,
      selectedMonthKey,
    ],
  );

  const sideInset = (screenWidth - ITEM_WIDTH) / 2;

  return (
    <View style={{ paddingBottom: 4 }}>
      <FlatList
        ref={flatListRef}
        data={dates}
        renderItem={renderItem}
        keyExtractor={(item) => item}
        extraData={selectedDate}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={ITEM_WIDTH}
        decelerationRate="fast"
        onScrollBeginDrag={() => {
          isUserScrolling.current = true;
        }}
        onMomentumScrollEnd={handleScrollEnd}
        contentContainerStyle={{
          paddingHorizontal: sideInset,
        }}
        getItemLayout={(_, index) => ({
          length: ITEM_WIDTH,
          offset: ITEM_WIDTH * index,
          index,
        })}
        initialScrollIndex={dates.indexOf(selectedDate)}
        onScrollToIndexFailed={() => {}}
      />
    </View>
  );
}
