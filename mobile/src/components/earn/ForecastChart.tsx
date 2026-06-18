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
  formatMonthYear,
  yForNorm,
} from "./chartGeometry";
import {
  buildProjection,
  getLoyalApyBps,
  getMainApyBps,
  TBILL_APY_BPS,
} from "./earnForecastModel";

// Forecast tab of the Earn chart (Figma 74-19520 resting / 74-19672 scrub).
// Real data: projects the current Earn balance forward 12 months at each
// series' APY — Loyal Earn (red, solid) from the live forecast, Main Market
// (dashed) from the latest Kamino reserve APY, T-Bill (dashed) at the fixed
// benchmark. Values are projected balances with dimmed cents; scrubbing reads
// the projection at the point under the finger.

const FORECAST_POINTS = 49; // ~weekly over a 12-month horizon, for a smooth scrub
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

type ForecastSeries = {
  color: string;
  label: string;
  apyBps: number;
  dashed: boolean;
  values: number[];
  norm: number[];
};

function formatMoney(value: number): string {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function splitDollars(value: number): { whole: string; cents: string } {
  const [whole, cents] = value.toFixed(2).split(".");
  return {
    whole: `$${Number(whole).toLocaleString("en-US")}`,
    cents: `.${cents}`,
  };
}

export function ForecastChart({
  summary,
  principalUsd,
}: {
  summary: EarnForecastSummary | null;
  principalUsd: number | null;
}) {
  const principal =
    principalUsd != null && Number.isFinite(principalUsd) && principalUsd > 0
      ? principalUsd
      : 0;

  const [chartWidth, setChartWidth] = useState(0);
  const [chartHeight, setChartHeight] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const lastIdxRef = useRef<number | null>(null);
  // Stable "now" anchor for the forward date labels.
  const nowMs = useMemo(() => Date.now(), []);

  const { series, axisMax } = useMemo(() => {
    const loyalApyBps = getLoyalApyBps(summary);
    const mainApyBps = getMainApyBps(summary);
    const build = (apyBps: number) =>
      buildProjection(principal, apyBps, FORECAST_POINTS);
    const loyalValues = build(loyalApyBps);
    const loyalTarget = loyalValues[loyalValues.length - 1];
    // Axis ceiling just above the top projection (nearest $10), like the design.
    const ceil = Math.max(
      principal + 10,
      Math.ceil(loyalTarget / 10) * 10,
    );
    const toNorm = (values: number[]) =>
      values.map((v) =>
        ceil > principal ? (v - principal) / (ceil - principal) : 0,
      );
    // Back-to-front draw order; Loyal (red, solid) on top.
    const built: ForecastSeries[] = [
      {
        color: COLOR_TBILL,
        label: "T-Bill",
        apyBps: TBILL_APY_BPS,
        dashed: true,
        values: build(TBILL_APY_BPS),
        norm: [],
      },
      {
        color: COLOR_MAIN,
        label: "Main Market",
        apyBps: mainApyBps,
        dashed: true,
        values: build(mainApyBps),
        norm: [],
      },
      {
        color: COLOR_LOYAL,
        label: "Loyal Earn",
        apyBps: loyalApyBps,
        dashed: false,
        values: loyalValues,
        norm: [],
      },
    ];
    for (const s of built) {
      s.norm = toNorm(s.values);
    }
    return { axisMax: ceil, series: built };
  }, [principal, summary]);

  const tbill = series[0];
  const main = series[1];
  const loyal = series[2];

  const lastIndex = FORECAST_POINTS - 1;
  const scrubbing = activeIndex !== null;
  const idx = Math.min(activeIndex ?? lastIndex, lastIndex);
  const hasData = principal > 0;

  const dateForIndex = useCallback(
    (i: number) => new Date(nowMs + (i / lastIndex) * YEAR_MS),
    [nowMs, lastIndex],
  );

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

  const activeX = chartWidth > 0 ? (idx / lastIndex) * chartWidth : 0;
  const dotX = scrubbing ? activeX : Math.max(0, chartWidth - DOT_RADIUS - 2);

  const renderValue = (value: number, textStyle: object, dimStyle: object) => {
    const { whole, cents } = splitDollars(value);
    return (
      <Text style={textStyle}>
        <Text style={textStyle}>{whole}</Text>
        <Text style={dimStyle}>{cents}</Text>
      </Text>
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.stats}>
        <View style={styles.valueBlock}>
          {renderValue(loyal.values[idx], styles.bigValue, styles.bigCents)}
          <View style={styles.subtitle}>
            <View style={[styles.dot, { backgroundColor: COLOR_LOYAL }]} />
            <Text style={styles.subtitleLabel}>
              Loyal Earn · {(loyal.apyBps / 100).toFixed(2)}% APY
            </Text>
          </View>
        </View>
        <View style={styles.smallRow}>
          <View style={styles.smallBlock}>
            {renderValue(main.values[idx], styles.smallValue, styles.smallCents)}
            <View style={styles.subtitle}>
              <View style={[styles.dot, { backgroundColor: COLOR_MAIN }]} />
              <Text style={styles.subtitleLabel}>
                Main Market · {(main.apyBps / 100).toFixed(2)}% APY
              </Text>
            </View>
          </View>
          <View style={styles.smallBlock}>
            {renderValue(
              tbill.values[idx],
              styles.smallValue,
              styles.smallCents,
            )}
            <View style={styles.subtitle}>
              <View style={[styles.dot, { backgroundColor: COLOR_TBILL }]} />
              <Text style={styles.subtitleLabel}>
                T-Bill · {(tbill.apyBps / 100).toFixed(2)}% APY
              </Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.axisRow}>
        <Text style={styles.axisLabel}>
          {scrubbing ? formatMonthYear(dateForIndex(idx)) : ""}
        </Text>
        <Text style={styles.axisLabel}>{formatMoney(axisMax)}</Text>
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
                strokeDasharray={s.dashed ? "5 4" : undefined}
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
        <Text style={styles.axisLabel}>Today · {formatMoney(principal)}</Text>
        <Text style={styles.axisLabel}>
          {formatMonthYear(dateForIndex(lastIndex))}
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
  bigCents: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 36,
    lineHeight: 48,
    color: "rgba(255, 255, 255, 0.4)",
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
  smallCents: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 20,
    lineHeight: 28,
    color: "rgba(255, 255, 255, 0.4)",
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
