import * as Haptics from "expo-haptics";
import { useCallback, useState } from "react";
import {
  type GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

type Period = "1W" | "1M" | "6M" | "1Y";

const PERIODS: Period[] = ["1W", "1M", "6M", "1Y"];

// Bar heights (px) in a 343-tall container, taken from the Figma reference for
// the 1M view. Other periods use synthesized accumulation curves so the chart
// always reads as a monotonically rising "earnings stack".
const BAR_HEIGHTS_1W = [42, 98, 156, 198, 244, 292, 343];

const BAR_HEIGHTS_1M = [
  6, 28, 42, 52, 66, 74, 82, 93, 104, 117, 130, 141, 159, 171, 177, 188, 203,
  219, 231, 248, 261, 277, 290, 301, 315, 321, 325, 330, 336, 343,
];

const BAR_HEIGHTS_6M = [
  18, 30, 46, 62, 78, 96, 114, 132, 148, 166, 184, 201, 218, 234, 248, 261,
  274, 287, 298, 308, 318, 326, 332, 337, 341, 343,
];

const BAR_HEIGHTS_1Y = [
  56, 112, 158, 192, 218, 244, 268, 290, 308, 322, 334, 343,
];

const PERIOD_DATA: Record<
  Period,
  { heights: number[]; total: number; axisMax: number }
> = {
  "1W": { heights: BAR_HEIGHTS_1W, total: 39.03, axisMax: 45 },
  "1M": { heights: BAR_HEIGHTS_1M, total: 165.66, axisMax: 180 },
  "6M": { heights: BAR_HEIGHTS_6M, total: 890.24, axisMax: 960 },
  "1Y": { heights: BAR_HEIGHTS_1Y, total: 1872.5, axisMax: 2000 },
};

const BAR_MAX_HEIGHT = 343;
const BAR_GAP = 6;

const COLOR_BAR_DIM = "rgba(50, 182, 124, 0.4)";
const COLOR_BAR_ACTIVE = "#32B67C";
const COLOR_DIM_WHITE = "rgba(255, 255, 255, 0.4)";
const COLOR_GREEN = "#32B67C";

const AXIS_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function splitDollars(value: number) {
  const [whole, cents] = value.toFixed(2).split(".");
  return {
    whole: `$${Number(whole).toLocaleString("en-US")}`,
    cents: `.${cents}`,
  };
}

export function EarnChart() {
  const [period, setPeriod] = useState<Period>("1M");
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState(0);
  // Bars area scales to whatever vertical room flex hands us, so figma heights
  // are stored as ratios of BAR_MAX_HEIGHT and multiplied by the measured
  // height at render. Avoids fixed-px overflow on shorter Android screens.
  const [barsAreaHeight, setBarsAreaHeight] = useState(0);

  const data = PERIOD_DATA[period];
  const { heights, total, axisMax } = data;

  const displayValue =
    activeIdx !== null
      ? (heights[activeIdx] / BAR_MAX_HEIGHT) * total
      : total;
  const { whole, cents } = splitDollars(displayValue);

  const handleSetActiveBar = useCallback(
    (event: GestureResponderEvent) => {
      if (chartWidth <= 0 || heights.length === 0) return;
      const ratio = Math.max(
        0,
        Math.min(1, event.nativeEvent.locationX / chartWidth),
      );
      const nextIdx = Math.min(
        heights.length - 1,
        Math.floor(ratio * heights.length),
      );
      setActiveIdx((prev) => (prev === nextIdx ? prev : nextIdx));
    },
    [chartWidth, heights.length],
  );

  const handleSelectPeriod = useCallback(
    (p: Period) => {
      if (p === period) return;
      void Haptics.selectionAsync();
      setActiveIdx(null);
      setPeriod(p);
    },
    [period],
  );

  return (
    <View style={styles.root}>
      {/* Earnings / Forecast tabs — inert for now, per spec. */}
      <View style={styles.tabsRow}>
        <View style={[styles.tab, styles.tabActive]}>
          <Text style={[styles.tabText, styles.tabTextActive]}>Earnings</Text>
        </View>
        <View style={styles.tab}>
          <Text style={styles.tabText}>Forecast</Text>
        </View>
      </View>

      <View style={styles.chartFrame}>
        <View style={styles.valuesRow}>
          <View style={styles.valuesLeft}>
            <Text style={styles.valueLine} numberOfLines={1}>
              <Text style={styles.valueWhole}>{whole}</Text>
              <Text style={styles.valueCents}>{cents}</Text>
            </Text>
            <Text style={styles.valueSubtitle}>+$39.03  past month</Text>
          </View>
          <Text style={styles.axisLabelMax}>{AXIS_FORMATTER.format(axisMax)}</Text>
        </View>

        <View
          style={styles.barsRow}
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
          onResponderRelease={() => setActiveIdx(null)}
          onResponderTerminate={() => setActiveIdx(null)}
        >
          {heights.map((h, i) => {
            const isActive = activeIdx === i;
            const isDimmed = activeIdx !== null && !isActive;
            const pixelHeight = (h / BAR_MAX_HEIGHT) * barsAreaHeight;
            return (
              <View
                key={`${period}-${i}`}
                // pointerEvents="none" so the responder target is always
                // barsRow — otherwise nativeEvent.locationX is relative to
                // the (~7px wide) bar, ratio ≈ 0, and activeIdx snaps to 0
                // mid-swipe.
                pointerEvents="none"
                style={[
                  styles.bar,
                  {
                    height: pixelHeight,
                    backgroundColor: isActive ? COLOR_BAR_ACTIVE : COLOR_BAR_DIM,
                    opacity: isDimmed ? 0.4 : 1,
                  },
                ]}
              />
            );
          })}
        </View>
      </View>

      <View style={styles.periodRow}>
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
        <Text style={styles.axisLabelMin}>$0.00</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 8,
  },
  tabsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 13,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9999,
  },
  tabActive: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  tabText: {
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    lineHeight: 20,
    color: "rgba(255, 255, 255, 0.6)",
  },
  tabTextActive: {
    color: "rgba(255, 255, 255, 0.8)",
  },
  chartFrame: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 2,
  },
  valuesRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingBottom: 8,
  },
  valuesLeft: {
    flexShrink: 1,
  },
  valueLine: {
    // Single rich-text line so $XX (white) and .YY (dim) stay on baseline.
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
    color: COLOR_DIM_WHITE,
  },
  valueSubtitle: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 20,
    color: COLOR_GREEN,
  },
  axisLabelMax: {
    fontFamily: "Geist_400Regular",
    fontSize: 13,
    lineHeight: 16,
    color: COLOR_DIM_WHITE,
    paddingTop: 32,
  },
  barsRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: BAR_GAP,
    overflow: "hidden",
  },
  bar: {
    flex: 1,
    minWidth: 1,
    borderRadius: 4,
  },
  periodRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  periodPills: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
    color: COLOR_DIM_WHITE,
    textAlign: "center",
  },
  periodTextActive: {
    color: "#FFF",
  },
  axisLabelMin: {
    fontFamily: "Geist_400Regular",
    fontSize: 13,
    lineHeight: 16,
    color: COLOR_DIM_WHITE,
    paddingLeft: 12,
  },
});
