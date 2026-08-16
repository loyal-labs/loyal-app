import * as Haptics from "expo-haptics";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useEarnForecast } from "@/hooks/wallet/useEarnForecast";

import { ApyChart } from "./ApyChart";
import { EarnChart } from "./EarnChart";
import { ForecastChart } from "./ForecastChart";

// Segmented control above the Earn chart (Figma 74-19216 / 74-19520): switches
// the chart between Earned (the bar/odometer chart), APY (multi-series line
// chart), and Forecast (projection lines).
type ChartTab = "earnings" | "apy" | "forecast";

const TABS: { key: ChartTab; label: string; enabled: boolean }[] = [
  { key: "earnings", label: "Earned", enabled: true },
  { key: "apy", label: "APY", enabled: true },
  { key: "forecast", label: "Forecast", enabled: true },
];

export function EarnChartTabs({
  principalUsd,
  walletAddress,
}: {
  principalUsd: number | null;
  walletAddress: string | null;
}) {
  const [tab, setTab] = useState<ChartTab>("forecast");
  // Global APY forecast + history feeds the APY and Forecast charts.
  const summary = useEarnForecast();

  const handleSelect = useCallback((next: ChartTab, enabled: boolean) => {
    if (!enabled) {
      return;
    }
    void Haptics.selectionAsync();
    setTab(next);
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.controlWrap}>
        <View style={styles.track}>
          {TABS.map(({ key, label, enabled }) => {
            const active = tab === key;
            return (
              <Pressable
                key={key}
                onPress={() => handleSelect(key, enabled)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active, disabled: !enabled }}
                accessibilityLabel={label}
                style={({ pressed }) => [
                  styles.segment,
                  active && styles.segmentActive,
                  { opacity: pressed && enabled ? 0.8 : 1 },
                ]}
              >
                <Text
                  style={[styles.segmentText, active && styles.segmentTextActive]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.chart}>
        {tab === "apy" ? (
          <ApyChart summary={summary} />
        ) : tab === "forecast" ? (
          <ForecastChart summary={summary} principalUsd={principalUsd} />
        ) : (
          <EarnChart walletAddress={walletAddress} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  controlWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  track: {
    flexDirection: "row",
    alignItems: "center",
    padding: 4,
    borderRadius: 44,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  segment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9999,
  },
  segmentActive: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  segmentText: {
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    lineHeight: 20,
    color: "rgba(255, 255, 255, 0.6)",
    textAlign: "center",
  },
  segmentTextActive: {
    color: "#FFF",
  },
  chart: {
    flex: 1,
  },
});
