import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowLeft, ArrowRight } from "lucide-react-native";
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
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { getShowTips } from "@/lib/settings";

type Period = "1W" | "1M" | "6M" | "1Y";

const PERIODS: Period[] = ["1W", "1M", "6M", "1Y"];

const COLOR_GREEN = "#32B67C";
const COLOR_GREEN_TRANSPARENT = "rgba(50, 182, 124, 0)";
const COLOR_WHITE = "#FFFFFF";
const COLOR_WHITE_TRANSPARENT = "rgba(255, 255, 255, 0)";
// Forecast bars fade out with a vertical gradient (opaque at the top → fully
// transparent at the baseline) rendered at low opacity. Its colour depends on
// which side of the selected bar the forecast bar sits on (Figma 3869:15514):
// green leads up to the selection, white lies beyond it. In the default state
// (Now selected) every forecast bar is to the right, so they're all white/gray.
const GRADIENT_GREEN: [string, string] = [COLOR_GREEN, COLOR_GREEN_TRANSPARENT];
const GRADIENT_WHITE: [string, string] = [COLOR_WHITE, COLOR_WHITE_TRANSPARENT];
const COLOR_DIM_WHITE_40 = "rgba(255, 255, 255, 0.4)";
const COLOR_DIM_WHITE_60 = "rgba(255, 255, 255, 0.6)";

// Per-bar opacity by position relative to the selected bar (from Figma). The
// selected bar is always solid green at full opacity; everything to its left is
// brighter than everything to its right, and forecast bars are dimmer still.
const OPACITY_LEFT = 0.4; // any bar before the selected one
const OPACITY_RIGHT_HISTORICAL = 0.2; // historical bars after the selected one
const OPACITY_RIGHT_FORECAST = 0.14; // forecast bars after the selected one

const BAR_RADIUS = 6;
// Bar heights as a fraction of the bars area, taken from Figma 3907:13485 (a
// 336px-tall chart) for the just-deposited state: the past sits on a flat zero
// baseline (thin dashes), the Now marker is a short pill, and the forecast
// ramps linearly up to the tallest bar — which stops short of the top, leaving
// headroom under the axis-max label.
const PAST_BASELINE_RATIO = 2 / 336;
const NOW_PILL_RATIO = 16 / 336;
const FORECAST_TOP_RATIO = 322 / 336;

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

// Live earnings ticker: the headline value accrues in real time off the mock
// Earn balance + APY shown on the tab, so the user sees progression from $0.
const PRINCIPAL_USD = 6165.662512;
const APY = 0.0846;
const EARNINGS_PER_SECOND = (PRINCIPAL_USD * APY) / (365 * 24 * 60 * 60);

// Rolling odometer for the live value: each digit is a clipped 0–9 strip that
// ticks up one cell at a time as earnings accrue. A digit holds still until its
// place increments, then rolls quickly to the next — like the cards on a flip
// clock. When the fastest digit wraps 9→0, the place to its left ticks.
const DIGIT_HEIGHT = 48; // matches the value line's lineHeight
// Two full 0–9 cycles so a 9→0 roll continues upward onto a duplicate digit,
// then resets invisibly (a tick never has to scroll backward to wrap).
const DIGIT_STRIP = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
];
// Every wheel derives its digit from one shared count of the smallest place, so
// they carry in lockstep (no per-wheel float drift at 9→0 boundaries). A
// wheel's `factor` is how many smallest-units make up one of its own units.
const SMALLEST_PLACE = 0.00001; // the 5th decimal
const WHOLE_FACTOR = 100_000; // whole dollars
const DECIMAL_FACTORS = [10_000, 1000, 100, 10, 1]; // .1 → .00001
const TICK_MS = 240; // quick discrete roll per increment
const TICK_EASING = Easing.out(Easing.cubic);

// Swipe hint over the chart, shown on every open while "Show tips" is enabled.
const HINT_FADE_MS = 300;
const HINT_VISIBLE_MS = 2000; // auto-dismiss 2s after it appears
const HINT_NUDGE = 12; // px the hint slides left/right once

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
  // `barCount` and the `nowIndex` boundary come from the Figma reference. Now
  // sits mid-chart: bars before it are the (zero) past, bars after it are the
  // forecast.
  barCount: number;
  nowIndex: number;
  now: number; // earnings at the Now bar (0 — just deposited)
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

// Mocked "just deposited the max amount" state (Figma 3907:13476): the position
// was funded today, so nothing has accrued through Now (`now`/`gain` are 0).
// The past is a flat zero baseline and the forecast grows from Now up to each
// period's projected `estimate`. The estimate/axisMax scale is kept from the
// Figma reference so the chart reads at the same size as the designed mock.
const PERIOD_CONFIG: Record<Period, PeriodConfig> = {
  "1W": {
    barCount: 13,
    nowIndex: 6,
    now: 0,
    estimate: 140.24,
    axisMax: 140,
    gain: 0,
    pastLabel: "so far",
    stepDays: 1,
    longDates: false,
    barGap: 6,
  },
  "1M": {
    barCount: 61,
    nowIndex: 30,
    now: 0,
    estimate: 612.4,
    axisMax: 620,
    gain: 0,
    pastLabel: "so far",
    stepDays: 1,
    longDates: false,
    barGap: 3,
  },
  "6M": {
    barCount: 12,
    nowIndex: 5,
    now: 0,
    estimate: 2840.0,
    axisMax: 2900,
    gain: 0,
    pastLabel: "so far",
    stepDays: 30,
    longDates: true,
    barGap: 6,
  },
  "1Y": {
    barCount: 23,
    nowIndex: 11,
    now: 0,
    estimate: 6240.0,
    axisMax: 6400,
    gain: 0,
    pastLabel: "so far",
    stepDays: 30,
    longDates: true,
    barGap: 6,
  },
};

// Just-deposited series (Figma 3907:13476): everything up to and including the
// Now bar is zero — the past renders as flat baseline dashes and Now as a short
// pill — and only the forecast grows, ramping linearly from Now up to the
// period `estimate` at the final bar. `values` are the dollar amounts shown in
// the header/tooltip; `heights` are the visual bar ratios.
function buildChartSeries(cfg: PeriodConfig): {
  values: number[];
  heights: number[];
} {
  const values: number[] = [];
  const heights: number[] = [];
  const futureSpan = cfg.barCount - 1 - cfg.nowIndex;
  for (let i = 0; i < cfg.barCount; i += 1) {
    if (i < cfg.nowIndex) {
      // Past: before the deposit existed, so nothing earned — a flat dash.
      values.push(0);
      heights.push(PAST_BASELINE_RATIO);
    } else if (i === cfg.nowIndex) {
      // Now: the moment of deposit; a short pill marking the present.
      values.push(cfg.now);
      heights.push(NOW_PILL_RATIO);
    } else {
      // Forecast: linear growth from Now up to the period estimate.
      const t = futureSpan > 0 ? (i - cfg.nowIndex) / futureSpan : 1;
      values.push(cfg.now + (cfg.estimate - cfg.now) * t);
      heights.push(NOW_PILL_RATIO + (FORECAST_TOP_RATIO - NOW_PILL_RATIO) * t);
    }
  }
  return { values, heights };
}

function formatMoney(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function splitDollars(value: number, decimals = 2) {
  const [whole, cents] = value.toFixed(decimals).split(".");
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

// A single bar. Renders its fill — solid green, or a vertical gradient whose
// colours the caller picks (green or white) for forecast bars — and grows up
// from the baseline on reveal: it reads the shared `progress` and maps an
// index-based slice of it to its scaleY, producing the left-to-right sweep
// without per-frame layout.
function ChartBar({
  index,
  barCount,
  height,
  gradientColors,
  opacity,
  progress,
}: {
  index: number;
  barCount: number;
  height: number;
  gradientColors: [string, string] | null;
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

  if (gradientColors) {
    return (
      <Animated.View
        pointerEvents="none"
        style={[styles.bar, { height, opacity }, animatedStyle]}
      >
        <LinearGradient
          colors={gradientColors}
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

// One odometer wheel for the digit at `place` (e.g. 0.001 → the third decimal).
// It watches that place's integer digit and, whenever it increments, rolls up
// one cell with a quick tick — holding still in between, entirely on the UI
// thread. On a 9→0 wrap it rolls onto the strip's duplicate digit, then resets
// position invisibly so the next tick is still an upward roll.
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
// (white), then the decimal point and five decimal wheels (dimmed) that scroll
// as earnings accrue.
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

// The headline earnings value. While `live` (the Now bar is selected) it rolls
// up in real time from $0 at the mock accrual rate, with extra decimals so the
// growth is visible; otherwise it shows the selected bar's static value. A
// single shared value, advanced each frame on the UI thread, drives the
// odometer — so the per-frame scroll never re-renders the bars.
function EarningsValue({
  live,
  ratePerSecond,
  staticValue,
  forecast,
}: {
  live: boolean;
  ratePerSecond: number;
  staticValue: number;
  forecast: boolean;
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
      frame.setActive(true);
    } else {
      // Pause accrual while scrubbing; reset the delta clock so resuming
      // continues smoothly from the held value rather than jumping ahead.
      frame.setActive(false);
      lastTs.value = 0;
    }
    return () => frame.setActive(false);
  }, [live, frame, lastTs]);

  if (live) {
    return <RollingOdometer value={value} />;
  }

  const { whole, cents } = splitDollars(staticValue, 2);
  return (
    <Text style={styles.valueLine} numberOfLines={1}>
      <Text style={styles.valueWhole}>
        {forecast ? "≈" : ""}
        {whole}
      </Text>
      <Text style={styles.valueCents}>{cents}</Text>
    </Text>
  );
}

export function EarnChart() {
  const [period, setPeriod] = useState<Period>("6M");
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

  // Swipe hint over the chart — shown on every open while "Show tips" is on.
  const [hintActive] = useState(getShowTips);
  const hintOpacity = useSharedValue(0);
  const hintNudge = useSharedValue(0);
  const hintDismissedRef = useRef(false);

  const { values, heights } = useMemo(() => buildChartSeries(cfg), [cfg]);
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

  const dismissHint = useCallback(() => {
    if (hintDismissedRef.current) {
      return;
    }
    hintDismissedRef.current = true;
    cancelAnimation(hintNudge);
    hintOpacity.value = withTiming(0, { duration: HINT_FADE_MS });
  }, [hintOpacity, hintNudge]);

  // Reveal the hint once the bars are measured: fade it in, nudge it left↔right
  // once, then auto-dismiss after a beat (or as soon as the user swipes).
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

  const dateForIndex = useCallback(
    (index: number) =>
      new Date(nowMs + (index - cfg.nowIndex) * cfg.stepDays * DAY_MS),
    [nowMs, cfg.nowIndex, cfg.stepDays],
  );

  const isForecast = activeIdx > cfg.nowIndex;
  const isNow = activeIdx === cfg.nowIndex;
  const displayValue = values[activeIdx];

  const handleSetActiveBar = useCallback(
    (event: GestureResponderEvent) => {
      dismissHint();
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
    [chartWidth, cfg.barCount, dismissHint],
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

      <EarningsValue
        live={isNow}
        forecast={isForecast}
        ratePerSecond={EARNINGS_PER_SECOND}
        staticValue={displayValue}
      />

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
        {heights.map((ratio, i) => {
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
          // Forecast bars are a gradient (the rest are solid green). Those
          // leading up to the selection (to its left) are green; those beyond
          // it (to its right) are white.
          const gradientColors =
            forecast && !selected
              ? i < activeIdx
                ? GRADIENT_GREEN
                : GRADIENT_WHITE
              : null;
          return (
            <ChartBar
              key={`${period}-${i}`}
              index={i}
              barCount={cfg.barCount}
              height={ratio * barsAreaHeight}
              gradientColors={gradientColors}
              opacity={opacity}
              progress={progress}
            />
          );
        })}

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
  // Rolling odometer: a row of single-digit windows + static "$"/"." glyphs,
  // all sharing the value line's metrics so they baseline-align.
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
    // Grow up from the baseline rather than from the bar's center.
    transformOrigin: "50% 100%",
  },
  barFill: {
    flex: 1,
  },
  // Centered overlay above the bars; pointerEvents="none" keeps swipes flowing
  // through to the bars row underneath.
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
