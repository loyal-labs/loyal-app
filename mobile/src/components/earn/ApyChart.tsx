import * as Haptics from "expo-haptics";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  type GestureResponderEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

import type { EarnForecastSummary } from "@/lib/solana/earn/earn-api";

import {
  buildLinePath,
  COLOR_DIM_WHITE_60,
  COLOR_LOYAL,
  COLOR_MAIN,
  COLOR_TBILL,
  DOT_RADIUS,
  formatChartDate,
  POINT_COUNT,
  yForNorm,
} from "./chartGeometry";
import {
  getLoyalApyBps,
  getLoyalSamples,
  getMainApyBps,
  getMainSamples,
  resampleSamples,
  TBILL_APY_BPS,
} from "./earnForecastModel";

// APY tab of the Earn chart (Figma 74-19216 resting / 74-19367 scrub). Real
// data: Loyal Earn + Main Market APY histories come from the global forecast
// summary; T-Bill is a fixed benchmark (flat line). Dragging scrubs a
// crosshair: the header reads the APY at the point under the finger, a
// timestamp appears, and everything to the right of the finger dims.

type ApySeries = {
  color: string;
  label: string;
  pct: number[]; // APY percent per point
  norm: number[]; // normalized height per point
};

function formatPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function ApyChart({ summary }: { summary: EarnForecastSummary | null }) {
  const [chartWidth, setChartWidth] = useState(0);
  const [chartHeight, setChartHeight] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const lastIdxRef = useRef<number | null>(null);

  // Loyal history is the reference timeline; Main is aligned to the same count;
  // T-Bill is a flat benchmark across it.
  const { series, dates, axisMaxPct } = useMemo(() => {
    const loyal = resampleSamples(getLoyalSamples(summary), POINT_COUNT);
    const main = resampleSamples(getMainSamples(summary), POINT_COUNT);
    const n = loyal.length;
    const loyalPct = loyal.map((s) => s.apyBps / 100);
    const mainPct =
      main.length === n
        ? main.map((s) => s.apyBps / 100)
        : loyal.map(() => getMainApyBps(summary) / 100);
    const tbillPct = loyal.map(() => TBILL_APY_BPS / 100);
    const maxPct = Math.max(0, ...loyalPct, ...mainPct, ...tbillPct);
    const ceil = Math.max(2, Math.ceil(maxPct + 0.5));
    const toNorm = (pct: number[]) => pct.map((p) => p / ceil);
    return {
      axisMaxPct: ceil,
      dates: loyal.map((s) => new Date(s.observedAt)),
      // Back-to-front draw order; Loyal (red) on top.
      series: [
        { color: COLOR_TBILL, label: "T-Bill", pct: tbillPct, norm: toNorm(tbillPct) },
        { color: COLOR_MAIN, label: "Main Market", pct: mainPct, norm: toNorm(mainPct) },
        { color: COLOR_LOYAL, label: "Loyal Earn", pct: loyalPct, norm: toNorm(loyalPct) },
      ] as ApySeries[],
    };
  }, [summary]);

  const main = series[1];
  const loyal = series[2];
  const pointCount = loyal.pct.length;
  const hasData = pointCount > 1;

  const lastIndex = Math.max(0, pointCount - 1);
  const scrubbing = activeIndex !== null;
  const idx = Math.min(activeIndex ?? lastIndex, lastIndex);

  // Header readouts: the scrubbed point, or the latest (fallback to the live
  // forecast APYs while the history loads).
  const loyalValue = hasData ? loyal.pct[idx] : getLoyalApyBps(summary) / 100;
  const mainValue = hasData ? main.pct[idx] : getMainApyBps(summary) / 100;
  const tbillValue = TBILL_APY_BPS / 100;

  const handleScrub = useCallback(
    (event: GestureResponderEvent) => {
      if (chartWidth <= 0 || !hasData) {
        return;
      }
      const ratio = Math.max(
        0,
        Math.min(1, event.nativeEvent.locationX / chartWidth),
      );
      const nextIndex = Math.round(ratio * lastIndex);
      if (lastIdxRef.current === nextIndex) {
        return;
      }
      lastIdxRef.current = nextIndex;
      void Haptics.selectionAsync();
      setActiveIndex(nextIndex);
    },
    [chartWidth, hasData, lastIndex],
  );

  const handleRelease = useCallback(() => {
    lastIdxRef.current = null;
    setActiveIndex(null);
  }, []);

  const activeX =
    chartWidth > 0 && lastIndex > 0 ? (idx / lastIndex) * chartWidth : 0;
  const dotX = scrubbing ? activeX : Math.max(0, chartWidth - DOT_RADIUS - 2);

  return (
    <View style={styles.root}>
      <View style={styles.stats}>
        <View style={styles.valueBlock}>
          <Text style={styles.bigValue}>{formatPct(loyalValue)}</Text>
          <View style={styles.subtitle}>
            <View style={[styles.dot, { backgroundColor: COLOR_LOYAL }]} />
            <Text style={styles.subtitleLabel}>Loyal Earn</Text>
          </View>
        </View>
        <View style={styles.smallRow}>
          <View style={styles.smallBlock}>
            <Text style={styles.smallValue}>{formatPct(mainValue)}</Text>
            <View style={styles.subtitle}>
              <View style={[styles.dot, { backgroundColor: COLOR_MAIN }]} />
              <Text style={styles.subtitleLabel}>Main Market</Text>
            </View>
          </View>
          <View style={styles.smallBlock}>
            <Text style={styles.smallValue}>{formatPct(tbillValue)}</Text>
            <View style={styles.subtitle}>
              <View style={[styles.dot, { backgroundColor: COLOR_TBILL }]} />
              <Text style={styles.subtitleLabel}>T-Bill</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.axisRow}>
        <Text style={styles.axisLabel}>
          {scrubbing && dates[idx] ? formatChartDate(dates[idx], true) : ""}
        </Text>
        <Text style={styles.axisLabel}>{formatPct(axisMaxPct)}</Text>
      </View>

      <View
        style={styles.chart}
        onLayout={(e) => {
          setChartWidth(e.nativeEvent.layout.width);
          setChartHeight(e.nativeEvent.layout.height);
        }}
        onStartShouldSetResponder={() => true}
        onStartShouldSetResponderCapture={() => true}
        onMoveShouldSetResponder={() => true}
        onMoveShouldSetResponderCapture={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={handleScrub}
        onResponderMove={handleScrub}
        onResponderRelease={handleRelease}
        onResponderTerminate={handleRelease}
      >
        {chartWidth > 0 && chartHeight > 0 && hasData ? (
          <Svg width={chartWidth} height={chartHeight}>
            {series.map((s) => (
              <Path
                key={s.label}
                d={buildLinePath(s.norm, chartWidth, chartHeight)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

            {scrubbing ? (
              <Rect
                x={activeX}
                y={0}
                width={Math.max(0, chartWidth - activeX)}
                height={chartHeight}
                fill="rgba(0, 0, 0, 0.6)"
              />
            ) : null}

            <Line
              x1={dotX}
              y1={0}
              x2={dotX}
              y2={chartHeight}
              stroke={COLOR_DIM_WHITE_60}
              strokeWidth={1}
              strokeOpacity={scrubbing ? 0.6 : 0.24}
              strokeDasharray={scrubbing ? "4 4" : undefined}
            />

            {series.map((s) => (
              <Circle
                key={`${s.label}-dot`}
                cx={dotX}
                cy={yForNorm(s.norm[idx], chartHeight)}
                r={DOT_RADIUS}
                fill={s.color}
              />
            ))}
          </Svg>
        ) : null}
      </View>

      <View style={styles.dateAxis}>
        <Text style={styles.axisLabel}>
          {dates[0] ? formatChartDate(dates[0], false) : ""}
        </Text>
        <Text style={styles.axisLabel}>
          {dates[lastIndex] ? formatChartDate(dates[lastIndex], false) : ""}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  stats: {
    gap: 16,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  valueBlock: {
    alignItems: "flex-start",
  },
  bigValue: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 36,
    lineHeight: 48,
    color: "#FFF",
  },
  smallRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  smallBlock: {
    flex: 1,
  },
  smallValue: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 20,
    lineHeight: 28,
    color: "#FFF",
  },
  subtitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 16,
    paddingVertical: 2,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 4,
  },
  subtitleLabel: {
    flex: 1,
    fontFamily: "Geist_400Regular",
    fontSize: 13,
    lineHeight: 16,
    color: COLOR_DIM_WHITE_60,
  },
  axisRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  axisLabel: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 20,
    color: COLOR_DIM_WHITE_60,
  },
  chart: {
    flex: 1,
    width: "100%",
  },
  dateAxis: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
});
