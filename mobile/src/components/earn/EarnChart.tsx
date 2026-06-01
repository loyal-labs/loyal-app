import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

type Period = "1W" | "1M" | "6M" | "1Y";

const PERIODS: Period[] = ["1W", "1M", "6M", "1Y"];

const COLOR_GREEN = "#32B67C";
// Same green at zero alpha — fade forecast bars to transparent (not black) so
// there's no muddy fringe. Matches the Figma gradient (green alpha 1 → 0).
const COLOR_GREEN_TRANSPARENT = "rgba(50, 182, 124, 0)";
const COLOR_DIM_WHITE_40 = "rgba(255, 255, 255, 0.4)";
const COLOR_DIM_WHITE_60 = "rgba(255, 255, 255, 0.6)";

// Per-bar opacity by position relative to the selected bar (from Figma). The
// selected bar is always solid green at full opacity; everything to its left is
// brighter than everything to its right, and forecast bars are dimmer still.
const OPACITY_LEFT = 0.4; // any bar before the selected one
const OPACITY_RIGHT_HISTORICAL = 0.2; // historical bars after the selected one
const OPACITY_RIGHT_FORECAST = 0.14; // forecast bars after the selected one

const BAR_RADIUS = 6;
const FIRST_BAR_RATIO = 0.12; // height of the shortest (leftmost) bar

// Reveal motion for the deposited-state chart.
const ENTER_EASING = Easing.bezier(0.22, 1, 0.36, 1);
// Bars grow up from the baseline with a left-to-right stagger. A single 0→1
// `progress` drives every bar; each bar maps a slice of it via its index, so
// the last bar starts at STAGGER_SPREAD and finishes as progress reaches 1.
const BARS_GROW_DURATION = 720;
const STAGGER_SPREAD = 0.55;
const GROW_WINDOW = 0.45;
// The whole chart fades + rises in on first appearance (not on period switch).
const APPEAR_DURATION = 360;
const APPEAR_RISE = 8;

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type PeriodConfig = {
  // Bar count and the "Now" boundary index come straight from the Figma
  // reference for each period (last historical bar = default selection).
  barCount: number;
  nowIndex: number;
  now: number; // cumulative earnings at the Now bar
  estimate: number; // projected earnings at the final (tallest) forecast bar
  axisMax: number; // top axis label
  gain: number; // earned over the period ("+$X")
  pastLabel: string; // e.g. "past week"
  stepDays: number; // spacing between bars, for the date labels
  longDates: boolean; // format axis/tooltip dates as "Month YYYY" vs "Month D"
  // Gap between bars (px). 1M packs ~60 bars, so it needs a tighter gap than the
  // others, or the gaps would consume the whole width and collapse the bars.
  barGap: number;
};

const PERIOD_CONFIG: Record<Period, PeriodConfig> = {
  "1W": {
    barCount: 13,
    nowIndex: 6,
    now: 120.48,
    estimate: 140.24,
    axisMax: 140,
    gain: 62.48,
    pastLabel: "past week",
    stepDays: 1,
    longDates: false,
    barGap: 6,
  },
  "1M": {
    barCount: 61,
    nowIndex: 30,
    now: 486.12,
    estimate: 612.4,
    axisMax: 620,
    gain: 210.6,
    pastLabel: "past month",
    stepDays: 1,
    longDates: false,
    barGap: 3,
  },
  "6M": {
    barCount: 12,
    nowIndex: 5,
    now: 1980.0,
    estimate: 2840.0,
    axisMax: 2900,
    gain: 1124.5,
    pastLabel: "past 6 months",
    stepDays: 30,
    longDates: true,
    barGap: 6,
  },
  "1Y": {
    barCount: 23,
    nowIndex: 11,
    now: 4120.0,
    estimate: 6240.0,
    axisMax: 6400,
    gain: 2860.0,
    pastLabel: "past year",
    stepDays: 30,
    longDates: true,
    barGap: 6,
  },
};

// Two linear ramps that meet at the Now bar, so the cumulative curve passes
// through `now` at the boundary and reaches `estimate` (full height) at the end.
function buildHeightRatios(cfg: PeriodConfig): number[] {
  const nowRatio = cfg.now / cfg.estimate;
  const ratios: number[] = [];
  for (let i = 0; i < cfg.barCount; i += 1) {
    if (i <= cfg.nowIndex) {
      const t = cfg.nowIndex === 0 ? 1 : i / cfg.nowIndex;
      ratios.push(FIRST_BAR_RATIO + (nowRatio - FIRST_BAR_RATIO) * t);
    } else {
      const t = (i - cfg.nowIndex) / (cfg.barCount - 1 - cfg.nowIndex);
      ratios.push(nowRatio + (1 - nowRatio) * t);
    }
  }
  return ratios;
}

function formatMoney(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function splitDollars(value: number) {
  const [whole, cents] = value.toFixed(2).split(".");
  return {
    whole: `$${Number(whole).toLocaleString("en-US")}`,
    cents: `.${cents}`,
  };
}

function formatDate(date: Date, longDates: boolean): string {
  return longDates
    ? `${MONTHS[date.getMonth()]} ${date.getFullYear()}`
    : `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

// A single bar. Renders its fill (solid green, or a green→transparent gradient
// for forecast bars) and grows up from the baseline on reveal: it reads the
// shared `progress` and maps an index-based slice of it to its scaleY, which
// produces the left-to-right sweep without per-frame layout.
function ChartBar({
  index,
  barCount,
  height,
  gradient,
  opacity,
  progress,
}: {
  index: number;
  barCount: number;
  height: number;
  gradient: boolean;
  opacity: number;
  progress: SharedValue<number>;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const start = barCount > 1 ? (index / (barCount - 1)) * STAGGER_SPREAD : 0;
    const grow = interpolate(
      progress.value,
      [start, start + GROW_WINDOW],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return { transform: [{ scaleY: grow }] };
  });

  if (gradient) {
    return (
      <Animated.View
        pointerEvents="none"
        style={[styles.bar, { height, opacity }, animatedStyle]}
      >
        <LinearGradient
          colors={[COLOR_GREEN, COLOR_GREEN_TRANSPARENT]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.barFill}
        />
      </Animated.View>
    );
  }
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.bar,
        { height, backgroundColor: COLOR_GREEN, opacity },
        animatedStyle,
      ]}
    />
  );
}

export function EarnChart() {
  const [period, setPeriod] = useState<Period>("1W");
  const cfg = PERIOD_CONFIG[period];
  // Default selection is the Now bar (the historical/forecast boundary).
  const [activeIdx, setActiveIdx] = useState(cfg.nowIndex);
  // Last index we fired feedback for, so a scrub only buzzes once per bar.
  const lastIdxRef = useRef(cfg.nowIndex);
  const [chartWidth, setChartWidth] = useState(0);
  // Bars scale to whatever vertical room flex hands us, so heights are stored
  // as ratios and multiplied by the measured area height at render time.
  const [barsAreaHeight, setBarsAreaHeight] = useState(0);

  // Reveal animations: `progress` drives the staggered bar grow (on first
  // appearance and on every period switch); `appear` fades + rises the whole
  // chart once, on first appearance only.
  const progress = useSharedValue(0);
  const appear = useSharedValue(0);

  const heightRatios = useMemo(() => buildHeightRatios(cfg), [cfg]);
  // "Now" timestamp, stable for the life of the screen, so the date labels
  // place the Now bar on today and fan out into past / future.
  const nowMs = useMemo(() => Date.now(), []);

  useEffect(() => {
    appear.value = withTiming(1, {
      duration: APPEAR_DURATION,
      easing: ENTER_EASING,
    });
    return () => cancelAnimation(appear);
  }, [appear]);

  // Grow the bars once they've been measured, and re-grow whenever the period
  // changes (handleSelectPeriod resets `progress` to 0 first, so the new bars
  // start collapsed and sweep back in).
  const barsReady = barsAreaHeight > 0;
  useEffect(() => {
    if (!barsReady) {
      return;
    }
    progress.value = withTiming(1, {
      duration: BARS_GROW_DURATION,
      easing: ENTER_EASING,
    });
    return () => cancelAnimation(progress);
  }, [period, barsReady, progress]);

  const rootAnimatedStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [
      { translateY: interpolate(appear.value, [0, 1], [APPEAR_RISE, 0]) },
    ],
  }));

  const dateForIndex = useCallback(
    (index: number) =>
      new Date(nowMs + (index - cfg.nowIndex) * cfg.stepDays * DAY_MS),
    [nowMs, cfg.nowIndex, cfg.stepDays],
  );

  const isForecast = activeIdx > cfg.nowIndex;
  const isNow = activeIdx === cfg.nowIndex;
  const displayValue = heightRatios[activeIdx] * cfg.estimate;
  const { whole, cents } = splitDollars(displayValue);

  const handleSetActiveBar = useCallback(
    (event: GestureResponderEvent) => {
      if (chartWidth <= 0) {
        return;
      }
      const ratio = Math.max(
        0,
        Math.min(1, event.nativeEvent.locationX / chartWidth),
      );
      const nextIdx = Math.min(
        cfg.barCount - 1,
        Math.floor(ratio * cfg.barCount),
      );
      if (lastIdxRef.current === nextIdx) {
        return;
      }
      lastIdxRef.current = nextIdx;
      void Haptics.selectionAsync();
      setActiveIdx(nextIdx);
    },
    [chartWidth, cfg.barCount],
  );

  const handleReleaseBar = useCallback(() => {
    lastIdxRef.current = cfg.nowIndex;
    setActiveIdx(cfg.nowIndex);
  }, [cfg.nowIndex]);

  const handleSelectPeriod = useCallback(
    (p: Period) => {
      if (p === period) {
        return;
      }
      void Haptics.selectionAsync();
      // Collapse synchronously so the incoming bars mount at scaleY 0 and sweep
      // back in (the [period] effect animates progress back to 1).
      progress.value = 0;
      lastIdxRef.current = PERIOD_CONFIG[p].nowIndex;
      setActiveIdx(PERIOD_CONFIG[p].nowIndex);
      setPeriod(p);
    },
    [period, progress],
  );

  const nowCenterX = ((cfg.nowIndex + 0.5) / cfg.barCount) * chartWidth;

  return (
    <Animated.View style={[styles.root, rootAnimatedStyle]}>
      <Text style={styles.label}>
        {isForecast ? "Estimated earnings" : "Earnings"}
      </Text>

      <Text style={styles.valueLine} numberOfLines={1}>
        <Text style={styles.valueWhole}>
          {isForecast ? "≈" : ""}
          {whole}
        </Text>
        <Text style={styles.valueCents}>{cents}</Text>
      </Text>

      <View style={styles.subtitleRow}>
        {isNow ? (
          <Text style={styles.subtitleGain}>
            +{formatMoney(cfg.gain)} {cfg.pastLabel}
          </Text>
        ) : (
          <Text style={styles.subtitleDate}>
            {formatDate(dateForIndex(activeIdx), cfg.longDates)}
          </Text>
        )}
        <Text style={styles.axisMax}>${cfg.axisMax.toLocaleString("en-US")}</Text>
      </View>

      <View
        style={[styles.barsRow, { gap: cfg.barGap }]}
        onLayout={(e) => {
          setChartWidth(e.nativeEvent.layout.width);
          setBarsAreaHeight(e.nativeEvent.layout.height);
        }}
        onStartShouldSetResponder={() => true}
        onStartShouldSetResponderCapture={() => true}
        onMoveShouldSetResponder={() => true}
        onMoveShouldSetResponderCapture={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={handleSetActiveBar}
        onResponderMove={handleSetActiveBar}
        onResponderRelease={handleReleaseBar}
        onResponderTerminate={handleReleaseBar}
      >
        {heightRatios.map((ratio, i) => {
          // The selected bar is always solid green at full opacity; the rest
          // dim by their position relative to it (see the opacity constants).
          const forecast = i > cfg.nowIndex;
          const selected = i === activeIdx;
          const opacity = selected
            ? 1
            : i < activeIdx
              ? OPACITY_LEFT
              : forecast
                ? OPACITY_RIGHT_FORECAST
                : OPACITY_RIGHT_HISTORICAL;
          return (
            <ChartBar
              key={`${period}-${i}`}
              index={i}
              barCount={cfg.barCount}
              height={ratio * barsAreaHeight}
              gradient={forecast && !selected}
              opacity={opacity}
              progress={progress}
            />
          );
        })}
      </View>

      <View style={styles.dateAxis}>
        <Text style={[styles.dateLabel, styles.dateStart]}>
          {formatDate(dateForIndex(0), cfg.longDates)}
        </Text>
        <Text
          style={[styles.dateLabel, styles.dateNow, { left: nowCenterX }]}
          pointerEvents="none"
        >
          Now
        </Text>
        <Text style={[styles.dateLabel, styles.dateEnd]}>
          {formatDate(dateForIndex(cfg.barCount - 1), cfg.longDates)}
        </Text>
      </View>

      <View style={styles.periodPills}>
        {PERIODS.map((p) => (
          <Pressable
            key={p}
            onPress={() => handleSelectPeriod(p)}
            accessibilityRole="button"
            accessibilityLabel={`Select ${p} period`}
            style={({ pressed }) => [
              styles.periodPill,
              period === p && styles.periodPillActive,
              pressed && { opacity: 0.8 },
            ]}
            hitSlop={6}
          >
            <Text
              style={[
                styles.periodText,
                period === p && styles.periodTextActive,
              ]}
            >
              {p}
            </Text>
          </Pressable>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    // Breathing room between the period pills and the white balance card below.
    paddingBottom: 16,
  },
  label: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 20,
    color: COLOR_DIM_WHITE_60,
  },
  valueLine: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 36,
    lineHeight: 48,
    letterSpacing: -0.4,
  },
  valueWhole: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 36,
    lineHeight: 48,
    color: "#FFF",
  },
  valueCents: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 36,
    lineHeight: 48,
    color: COLOR_DIM_WHITE_40,
  },
  subtitleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingBottom: 8,
  },
  subtitleGain: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 20,
    color: COLOR_GREEN,
  },
  subtitleDate: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 20,
    color: COLOR_DIM_WHITE_60,
  },
  axisMax: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 20,
    color: COLOR_DIM_WHITE_40,
  },
  barsRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    overflow: "hidden",
  },
  bar: {
    flex: 1,
    minWidth: 1,
    borderRadius: BAR_RADIUS,
    overflow: "hidden",
    // Grow up from the baseline rather than from the bar's center.
    transformOrigin: "50% 100%",
  },
  barFill: {
    flex: 1,
  },
  dateAxis: {
    position: "relative",
    height: 16,
    marginTop: 8,
  },
  dateLabel: {
    fontFamily: "Geist_400Regular",
    fontSize: 13,
    lineHeight: 16,
    color: COLOR_DIM_WHITE_40,
  },
  dateStart: {
    position: "absolute",
    left: 0,
    top: 0,
  },
  dateEnd: {
    position: "absolute",
    right: 0,
    top: 0,
  },
  dateNow: {
    position: "absolute",
    top: 0,
    transform: [{ translateX: -16 }],
  },
  periodPills: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
  },
  periodPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9999,
  },
  periodPillActive: {
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  periodText: {
    fontFamily: "Geist_500Medium",
    fontSize: 14,
    lineHeight: 20,
    color: COLOR_DIM_WHITE_40,
    textAlign: "center",
  },
  periodTextActive: {
    color: "#FFF",
  },
});
