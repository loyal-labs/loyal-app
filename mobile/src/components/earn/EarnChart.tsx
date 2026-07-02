import * as Haptics from "expo-haptics";
import { ArrowLeft, ArrowRight } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type GestureResponderEvent,
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
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { Skeleton } from "@/components/Skeleton";
import { useEarnEarnings } from "@/hooks/wallet/useEarnEarnings";
import type { EarnEarningsBar } from "@/lib/solana/earn/earn-api";
import { getShowTips } from "@/lib/settings";

const COLOR_WHITE = "#FFFFFF";
const COLOR_RED = "#F9363C"; // Figma "Brand Red" — the scrub highlight
const COLOR_GREEN = "#32B67C"; // the "+$X past month" gain subtitle
const COLOR_DIM_WHITE_40 = "rgba(255, 255, 255, 0.4)";
const COLOR_DIM_WHITE_60 = "rgba(255, 255, 255, 0.6)";

// Bar opacities, relative to the scrub cursor (Figma 74-20800). Default (not
// scrubbing) every bar is a calm dim white; while scrubbing, only the selected
// bar reads as earned (brighter), every other bar stays dim.
const OPACITY_DEFAULT = 0.32;
const OPACITY_EARNED = 0.85; // the selected bar while scrubbing (red)
const OPACITY_BEYOND = 0.2; // every non-selected bar while scrubbing (white)

const BAR_RADIUS = 6;
const BAR_GAP = 3; // ~30 daily bars pack tightly
// Flat zero baseline for ~zero bars so a just-funded position still reads as a
// dashed baseline (Figma 74-19824 "new") rather than nothing.
const MIN_BAR_RATIO = 4 / 336;
// The tallest daily bar stops short of the top, leaving headroom under the
// axis-max label.
const AXIS_HEADROOM = 1.12;
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Swipe hint over the chart, shown on every open while "Show tips" is enabled.
const HINT_FADE_MS = 300;
const HINT_VISIBLE_MS = 2000;
const HINT_NUDGE = 12;

// Reveal motion.
const ENTER_EASING = Easing.bezier(0.22, 1, 0.36, 1);
const BARS_GROW_DURATION = 720;
const STAGGER_SPREAD = 0.55;
const GROW_WINDOW = 0.45;
const APPEAR_DURATION = 360;
const APPEAR_RISE = 8;

// Rolling odometer for the live value: each digit is a clipped 0–9 strip that
// ticks up one cell as earnings accrue (see RollingDigit).
const DIGIT_HEIGHT = 48; // matches the value line's lineHeight
const DIGIT_STRIP = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
];
const SMALLEST_PLACE = 0.00001; // the 5th decimal
const WHOLE_FACTOR = 100_000; // whole dollars
const DECIMAL_FACTORS = [10_000, 1000, 100, 10, 1]; // .1 → .00001
const TICK_MS = 240;
const TICK_EASING = Easing.out(Easing.cubic);

// The "past month" gain. Shown to full precision (up to 6 dp, the Earn balance
// decimals) so sub-cent monthly earnings read as e.g. "+$0.013521" instead of
// collapsing to "+$0.01" — matching the web. minimumFractionDigits 2 keeps
// normal amounts at cents (e.g. "+$1.50").
function formatGain(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })}`;
}

function splitDollars(value: number, decimals = 2) {
  const [whole, cents] = value.toFixed(decimals).split(".");
  return {
    whole: `$${Number(whole).toLocaleString("en-US")}`,
    cents: `.${cents}`,
  };
}

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  return `${SHORT_MONTHS[date.getMonth()]} ${date.getDate()}`;
}

// Axis ceiling: a round amount just above the tallest daily bar so it stops
// short of the top. Scales to the data at any magnitude — no fixed floor — so
// sub-cent earnings (e.g. $0.0002) aren't crushed against a $0.01 axis.
function niceAxisMax(maxValue: number): number {
  if (!Number.isFinite(maxValue) || maxValue <= 0) {
    return 0;
  }
  const padded = maxValue * AXIS_HEADROOM;
  const magnitude = 10 ** Math.floor(Math.log10(padded));
  const quantum = magnitude / 10;
  return Math.ceil(padded / quantum) * quantum;
}

// Axis-ceiling label. Whole amounts drop decimals ("$140"); regular amounts show
// cents ("$0.14"); sub-cent ceilings show just enough precision (matching the
// headline odometer) so a tiny ceiling isn't flattened to a misleading "$0.00".
function formatAxisLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "$0.00";
  }
  if (value >= 0.01) {
    const decimals = Number.isInteger(value) ? 0 : 2;
    return `$${value.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`;
  }
  return `$${value.toFixed(5).replace(/0+$/, "").replace(/\.$/, "")}`;
}

// One bar. Reads the shared `progress` and maps an index-based slice of it to its
// scaleY, producing the staggered left-to-right grow without per-frame layout.
function ChartBar({
  index,
  barCount,
  height,
  color,
  opacity,
  dashed,
  progress,
}: {
  index: number;
  barCount: number;
  height: number;
  color: string;
  opacity: number;
  dashed: boolean;
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

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.bar,
        {
          height,
          opacity,
          ...(dashed
            ? {
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: color,
                backgroundColor: "transparent",
              }
            : { backgroundColor: color }),
        },
        animatedStyle,
      ]}
    />
  );
}

// One odometer wheel for the digit at `place`. It watches that place's integer
// digit and, whenever it increments, rolls up one cell with a quick tick.
function RollingDigit({
  value,
  factor,
  color,
}: {
  value: SharedValue<number>;
  factor: number;
  color: string;
}) {
  const translateY = useSharedValue(0);
  const cell = useSharedValue(0);

  useAnimatedReaction(
    () => Math.floor(value.value / SMALLEST_PLACE / factor),
    (count, prev) => {
      const digit = ((count % 10) + 10) % 10;
      if (prev === null) {
        cell.value = digit;
        translateY.value = -digit * DIGIT_HEIGHT;
        return;
      }
      if (count === prev) {
        return;
      }
      const prevDigit = ((prev % 10) + 10) % 10;
      const steps = (((digit - prevDigit) % 10) + 10) % 10 || 10;
      const target = cell.value + steps;
      cell.value = target;
      translateY.value = withTiming(
        -target * DIGIT_HEIGHT,
        { duration: TICK_MS, easing: TICK_EASING },
        (finished) => {
          if (finished) {
            const normalized = ((target % 10) + 10) % 10;
            cell.value = normalized;
            translateY.value = -normalized * DIGIT_HEIGHT;
          }
        },
      );
    },
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <View style={styles.digitWindow}>
      <Animated.View style={animatedStyle}>
        {DIGIT_STRIP.map((n, i) => (
          <Text key={`${n}-${i}`} style={[styles.odometerChar, { color }]}>
            {n}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

// The live headline value as a rolling odometer: "$", a whole-dollar wheel
// (white), the decimal point, and five decimal wheels (dimmed) that scroll as
// earnings accrue.
function RollingOdometer({ value }: { value: SharedValue<number> }) {
  return (
    <View style={styles.odometer}>
      <Text style={[styles.odometerChar, styles.odometerWhole]}>$</Text>
      <RollingDigit value={value} factor={WHOLE_FACTOR} color="#FFF" />
      <Text style={[styles.odometerChar, styles.odometerCents]}>.</Text>
      {DECIMAL_FACTORS.map((factor) => (
        <RollingDigit
          key={factor}
          value={value}
          factor={factor}
          color={COLOR_DIM_WHITE_40}
        />
      ))}
    </View>
  );
}

// The headline earnings value. While `live` (the current/today bar is selected)
// it rolls up in real time from `baseValue` at `ratePerSecond` (seeded with the
// time elapsed since the data was fetched); otherwise it shows the scrubbed
// bar's static per-day value. A single shared value, advanced each frame on
// the UI thread, drives the odometer — so the per-frame scroll never re-renders
// the bars.
function EarningsValue({
  live,
  baseValue,
  ratePerSecond,
  anchorMs,
  staticValue,
}: {
  live: boolean;
  baseValue: number;
  ratePerSecond: number;
  anchorMs: number | null;
  staticValue: number;
}) {
  const value = useSharedValue(0);
  const lastTs = useSharedValue(0);

  const frame = useFrameCallback((info) => {
    if (lastTs.value !== 0) {
      value.value += ((info.timestamp - lastTs.value) / 1000) * ratePerSecond;
    }
    lastTs.value = info.timestamp;
  }, false);

  useEffect(() => {
    if (live) {
      const elapsedSec = anchorMs
        ? Math.max(0, (Date.now() - anchorMs) / 1000)
        : 0;
      value.value = baseValue + ratePerSecond * elapsedSec;
      lastTs.value = 0;
      frame.setActive(true);
    } else {
      frame.setActive(false);
      lastTs.value = 0;
    }
    return () => frame.setActive(false);
  }, [live, baseValue, ratePerSecond, anchorMs, frame, value, lastTs]);

  if (live) {
    return <RollingOdometer value={value} />;
  }

  // Per-day earnings are often sub-cent, so match the live odometer's 5-decimal
  // precision rather than rounding a real value to "$0.00".
  const { whole, cents } = splitDollars(staticValue, 5);
  return (
    <Text style={styles.valueLine} numberOfLines={1}>
      <Text style={styles.valueWhole}>{whole}</Text>
      <Text style={styles.valueCents}>{cents}</Text>
    </Text>
  );
}

// Per-bar daily earned (NOT cumulative): each bar is the amount earned within
// that day. The current (in-progress) bar is reconciled against the live total
// so it reflects earnings beyond the prior recorded days, without turning the
// earlier bars into a running total — mirrors the web Earnings chart.
function buildDailyValues(bars: EarnEarningsBar[], liveTotal: number): number[] {
  const safeTotal = Math.max(0, liveTotal);
  const nonCurrentRecorded = bars.reduce(
    (sum, bar) => (bar.isCurrent ? sum : sum + Math.max(0, bar.earnedUsd)),
    0,
  );
  const currentResidual = Math.max(0, safeTotal - nonCurrentRecorded);
  return bars.map((bar) =>
    bar.isCurrent
      ? Math.max(0, bar.earnedUsd, currentResidual)
      : Math.max(0, bar.earnedUsd),
  );
}

// Dark-surface skeleton tint — the chart lives on the black Earn hero, so the
// light-surface default would glare.
const SKELETON_TINT = "rgba(255, 255, 255, 0.12)";
const SKELETON_BAR_COUNT = 30;
// A static, believable bar silhouette so the placeholder reads as the earnings
// chart. Deterministic wave (no random) so it never reflows between renders.
const SKELETON_BAR_RATIOS = Array.from({ length: SKELETON_BAR_COUNT }, (_, i) =>
  Math.max(0.18, Math.min(1, 0.55 + 0.4 * Math.sin(i * 0.7) * Math.cos(i * 0.27))),
);

// Loading placeholder mirroring the chart's anatomy — headline value, subtitle +
// axis label, the bar field, and the date axis — each pulsing. Same paddings as
// the real chart so the swap-in doesn't shift anything.
function ChartSkeleton() {
  return (
    <View style={styles.root}>
      <Skeleton style={styles.skeletonValue} />
      <View style={styles.subtitleRow}>
        <Skeleton style={styles.skeletonSubtitle} />
        <Skeleton style={styles.skeletonAxis} />
      </View>
      <Skeleton style={[styles.barsRow, { gap: BAR_GAP }]}>
        {SKELETON_BAR_RATIOS.map((ratio, i) => (
          <View
            key={i}
            style={[styles.skeletonBar, { height: `${Math.round(ratio * 100)}%` }]}
          />
        ))}
      </Skeleton>
      <View style={styles.dateAxis}>
        <Skeleton style={[styles.skeletonDate, styles.dateStart]} />
        <Skeleton style={[styles.skeletonDate, styles.dateEnd]} />
      </View>
    </View>
  );
}

export function EarnChart({ walletAddress }: { walletAddress: string | null }) {
  const { earnings, fetchedAtMs, hasLoaded } = useEarnEarnings(walletAddress);
  const bars = useMemo(() => earnings?.bars ?? [], [earnings]);
  const barCount = bars.length;
  const lastIndex = Math.max(0, barCount - 1);
  const hasData = barCount > 0;
  // Show the skeleton only until the first read settles. Once it has (with bars,
  // or empty/errored), we never fall back to it — so a quiet refresh of an
  // already-drawn chart doesn't blink, and a failed read shows the empty chart.
  const showSkeleton = !hasData && !hasLoaded;

  // Live odometer inputs.
  const principalUsd = earnings?.principalUsd ?? 0;
  const apyBps = earnings?.currentApyBps ?? 0;
  const ratePerSecond = (apyBps / 10_000) * (principalUsd / SECONDS_PER_YEAR);
  const baseEarned = earnings?.sinceLastDepositEarnedUsd ?? 0;
  const rangeEarned = earnings?.rangeEarnedUsd ?? 0;

  // Bars show per-day earnings (static per load); the headline odometer ticks
  // live above. The axis ceiling tracks the tallest *historical* daily bar —
  // excluding the in-progress current bar, which can spike — recomputed only
  // when data lands.
  const { daily, axisMax } = useMemo(() => {
    const values = buildDailyValues(bars, baseEarned);
    let max = 0;
    for (let i = 0; i < bars.length; i += 1) {
      if (!bars[i].isCurrent) {
        max = Math.max(max, values[i]);
      }
    }
    // Day one: no completed day has earnings yet, so the historical ceiling is
    // 0 and every bar collapses to the minimum sliver. Scale to the in-progress
    // bar instead so the first day's accrual reads as a real bar.
    if (max <= 0) {
      for (const value of values) {
        max = Math.max(max, value);
      }
    }
    return { daily: values, axisMax: niceAxisMax(max) };
  }, [bars, baseEarned]);

  // Default selection is the current (today) bar; scrubbing moves it. `scrubbing`
  // drives the red highlight; `live` (today selected) drives the odometer.
  const [activeIdx, setActiveIdx] = useState(lastIndex);
  const [scrubbing, setScrubbing] = useState(false);
  const lastIdxRef = useRef(lastIndex);
  const [chartWidth, setChartWidth] = useState(0);
  const [barsAreaHeight, setBarsAreaHeight] = useState(0);

  // Keep the selection pinned to the latest bar as data loads/changes.
  useEffect(() => {
    if (!scrubbing) {
      setActiveIdx(lastIndex);
      lastIdxRef.current = lastIndex;
    }
  }, [lastIndex, scrubbing]);

  const progress = useSharedValue(0);
  const appear = useSharedValue(0);

  const [hintActive] = useState(getShowTips);
  const hintOpacity = useSharedValue(0);
  const hintNudge = useSharedValue(0);
  const hintDismissedRef = useRef(false);

  useEffect(() => {
    appear.value = withTiming(1, {
      duration: APPEAR_DURATION,
      easing: ENTER_EASING,
    });
    return () => cancelAnimation(appear);
  }, [appear]);

  const barsReady = barsAreaHeight > 0 && hasData;
  useEffect(() => {
    if (!barsReady) {
      return;
    }
    progress.value = withTiming(1, {
      duration: BARS_GROW_DURATION,
      easing: ENTER_EASING,
    });
    return () => cancelAnimation(progress);
  }, [barsReady, progress]);

  const dismissHint = useCallback(() => {
    if (hintDismissedRef.current) {
      return;
    }
    hintDismissedRef.current = true;
    cancelAnimation(hintNudge);
    hintOpacity.value = withTiming(0, { duration: HINT_FADE_MS });
  }, [hintOpacity, hintNudge]);

  useEffect(() => {
    if (!hintActive || !barsReady) {
      return;
    }
    hintOpacity.value = withTiming(1, {
      duration: HINT_FADE_MS,
      easing: ENTER_EASING,
    });
    hintNudge.value = withDelay(
      HINT_FADE_MS,
      withSequence(
        withTiming(-HINT_NUDGE, { duration: 260, easing: ENTER_EASING }),
        withTiming(HINT_NUDGE, { duration: 460, easing: ENTER_EASING }),
        withTiming(0, { duration: 260, easing: ENTER_EASING }),
      ),
    );
    const timer = setTimeout(dismissHint, HINT_VISIBLE_MS);
    return () => {
      clearTimeout(timer);
      cancelAnimation(hintOpacity);
      cancelAnimation(hintNudge);
    };
  }, [hintActive, barsReady, hintOpacity, hintNudge, dismissHint]);

  const hintAnimatedStyle = useAnimatedStyle(() => ({
    opacity: hintOpacity.value,
    transform: [{ translateX: hintNudge.value }],
  }));

  const rootAnimatedStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [
      { translateY: interpolate(appear.value, [0, 1], [APPEAR_RISE, 0]) },
    ],
  }));

  const handleSetActiveBar = useCallback(
    (event: GestureResponderEvent) => {
      dismissHint();
      if (chartWidth <= 0 || !hasData) {
        return;
      }
      setScrubbing(true);
      const ratio = Math.max(
        0,
        Math.min(1, event.nativeEvent.locationX / chartWidth),
      );
      const nextIdx = Math.min(lastIndex, Math.floor(ratio * barCount));
      if (lastIdxRef.current === nextIdx) {
        return;
      }
      lastIdxRef.current = nextIdx;
      void Haptics.selectionAsync();
      setActiveIdx(nextIdx);
    },
    [chartWidth, hasData, lastIndex, barCount, dismissHint],
  );

  const handleReleaseBar = useCallback(() => {
    setScrubbing(false);
    lastIdxRef.current = lastIndex;
    setActiveIdx(lastIndex);
  }, [lastIndex]);

  // Resting on the latest bar shows the live cumulative odometer; scrubbing any
  // bar (today included) shows that bar's static per-day value.
  const live = hasData && !scrubbing && activeIdx === lastIndex;
  const selectedBar = bars[activeIdx];
  const cursorCenterX =
    barCount > 0 ? ((activeIdx + 0.5) / barCount) * chartWidth : 0;

  // Placed after all hooks so the hook order stays stable across the swap.
  if (showSkeleton) {
    return <ChartSkeleton />;
  }

  return (
    <Animated.View style={[styles.root, rootAnimatedStyle]}>
      <EarningsValue
        live={live}
        baseValue={daily[lastIndex] ?? 0}
        ratePerSecond={ratePerSecond}
        anchorMs={fetchedAtMs}
        staticValue={daily[activeIdx] ?? 0}
      />

      <View style={styles.subtitleRow}>
        {scrubbing && selectedBar ? (
          <Text style={styles.subtitleDate}>
            {formatShortDate(selectedBar.endAt)}
          </Text>
        ) : (
          <Text style={styles.subtitleGain}>
            {`+${formatGain(rangeEarned)} past month`}
          </Text>
        )}
        <Text style={styles.axisMax}>{formatAxisLabel(axisMax)}</Text>
      </View>

      <View
        style={[styles.barsRow, { gap: BAR_GAP }]}
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
        {daily.map((value, i) => {
          // Clamp the top so the in-progress current bar (excluded from axisMax)
          // can't overflow past the chart height.
          const ratio =
            axisMax > 0
              ? Math.min(1, Math.max(MIN_BAR_RATIO, value / axisMax))
              : MIN_BAR_RATIO;
          // While scrubbing, only the selected bar reads as earned (red); the
          // rest stay a calm dim white. At rest the whole series is dim white.
          const earned = scrubbing && i === activeIdx;
          const color = earned ? COLOR_RED : COLOR_WHITE;
          const opacity = scrubbing
            ? earned
              ? OPACITY_EARNED
              : OPACITY_BEYOND
            : OPACITY_DEFAULT;
          return (
            <ChartBar
              key={i}
              index={i}
              barCount={barCount}
              height={ratio * barsAreaHeight}
              color={color}
              opacity={opacity}
              dashed={bars[i]?.isCurrent ?? false}
              progress={progress}
            />
          );
        })}

        {scrubbing && hasData ? (
          <View
            pointerEvents="none"
            style={[styles.cursor, { left: cursorCenterX }]}
          />
        ) : null}

        {hintActive ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.swipeHint, hintAnimatedStyle]}
          >
            <View style={styles.swipeHintPill}>
              <ArrowLeft size={16} color={COLOR_DIM_WHITE_60} strokeWidth={2} />
              <Text style={styles.swipeHintText}>Swipe</Text>
              <ArrowRight size={16} color={COLOR_DIM_WHITE_60} strokeWidth={2} />
            </View>
          </Animated.View>
        ) : null}
      </View>

      <View style={styles.dateAxis}>
        <Text style={[styles.dateLabel, styles.dateStart]}>
          {hasData ? formatShortDate(bars[0].startAt) : ""}
        </Text>
        <Text style={[styles.dateLabel, styles.dateEnd]}>
          {hasData ? formatShortDate(bars[lastIndex].endAt) : ""}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
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
  odometer: {
    flexDirection: "row",
    alignItems: "flex-start",
    height: DIGIT_HEIGHT,
  },
  digitWindow: {
    height: DIGIT_HEIGHT,
    overflow: "hidden",
  },
  odometerChar: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 36,
    lineHeight: DIGIT_HEIGHT,
    height: DIGIT_HEIGHT,
    letterSpacing: -0.4,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
    includeFontPadding: false,
  },
  odometerWhole: {
    color: "#FFF",
  },
  odometerCents: {
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
    transformOrigin: "50% 100%",
  },
  cursor: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    borderRadius: 1,
    backgroundColor: COLOR_RED,
  },
  swipeHint: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  swipeHintPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9999,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  swipeHintText: {
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    lineHeight: 20,
    color: COLOR_DIM_WHITE_60,
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
  // Loading skeleton — sized to the 48px value line box (36 + 6 + 6) and the
  // surrounding rows so the real chart drops in without a layout jump.
  skeletonValue: {
    height: 36,
    width: 170,
    marginVertical: 6,
    borderRadius: 10,
    backgroundColor: SKELETON_TINT,
  },
  skeletonSubtitle: {
    height: 14,
    width: 130,
    borderRadius: 7,
    backgroundColor: SKELETON_TINT,
  },
  skeletonAxis: {
    height: 14,
    width: 48,
    borderRadius: 7,
    backgroundColor: SKELETON_TINT,
  },
  skeletonBar: {
    flex: 1,
    minWidth: 1,
    borderRadius: BAR_RADIUS,
    backgroundColor: SKELETON_TINT,
  },
  skeletonDate: {
    height: 12,
    width: 36,
    borderRadius: 6,
    backgroundColor: SKELETON_TINT,
  },
});
