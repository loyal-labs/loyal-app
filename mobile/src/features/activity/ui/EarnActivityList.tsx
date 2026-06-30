import { Pressable, StyleSheet } from "react-native";

import type {
  EarnAutodepositScheduledSweep,
  EarnTransactionItem,
} from "@/lib/solana/earn/earn-api";
import {
  formatScheduledSweepAmount,
  formatScheduledSweepTime,
  isScheduledSweepAwaitingExecution,
} from "@/lib/solana/earn/earn-scheduled-sweep";
import {
  formatEarnRowTime,
  getEarnTransactionAmountColor,
  getEarnTransactionRowLabel,
  groupEarnTransactions,
} from "@/lib/solana/earn/earn-tx-display";
import { Text, View } from "@/tw";

import { useActivity } from "../model/ActivityProvider";
import { EarnTxAccountIcon, EarnTxCompoundIcon } from "./EarnTxIcon";

const SECONDARY = "rgba(60, 60, 67, 0.6)";
const BRAND_RED = "#F9363C";

function EarnTransactionRow({ item }: { item: EarnTransactionItem }) {
  const label = getEarnTransactionRowLabel(item);
  const amountColor = getEarnTransactionAmountColor(item.kind);

  return (
    <View className="flex-row items-center px-4 py-2.5">
      <EarnTxCompoundIcon item={item} />
      <View className="ml-3 flex-1">
        <Text className="text-[17px] font-medium text-black">{label}</Text>
        <View className="mt-0.5 flex-row items-center gap-1">
          <EarnTxAccountIcon account={item.source} />
          <Text
            className="text-[13px]"
            style={{ color: SECONDARY }}
            numberOfLines={1}
          >
            {item.source.label}
          </Text>
          <Text className="text-[13px]" style={{ color: SECONDARY }}>
            →
          </Text>
          <EarnTxAccountIcon account={item.destination} />
          <Text
            className="text-[13px]"
            style={{ color: SECONDARY }}
            numberOfLines={1}
          >
            {item.destination.label}
          </Text>
        </View>
      </View>
      <View className="items-end">
        <Text className="text-[17px]" style={{ color: amountColor }}>
          {item.amount}
        </Text>
        <Text className="text-[13px]" style={{ color: SECONDARY }}>
          {formatEarnRowTime(item)}
        </Text>
      </View>
    </View>
  );
}

// A pending Autodeposit "bootstrap" sweep (Figma 74:18455): wallet surplus the
// backend will move into Earn after its window, with an "Execute now" shortcut
// to run it immediately. Funds flow Main -> Earn, so it shows the deposit icon.
function EarnScheduledRow({
  sweep,
  isExecuting,
  onExecute,
}: {
  sweep: EarnAutodepositScheduledSweep;
  isExecuting: boolean;
  onExecute: () => void;
}) {
  const awaiting = isScheduledSweepAwaitingExecution(sweep);
  const disabled = isExecuting || awaiting;
  const buttonLabel = isExecuting
    ? "Requesting…"
    : awaiting
      ? "Executing…"
      : "Execute now";

  return (
    <View className="flex-row items-start px-4 py-2.5">
      <EarnTxCompoundIcon item={{ kind: "balance_sweep" }} />
      <View className="ml-3 flex-1">
        <Text className="text-[17px] font-medium text-black">Autodeposit</Text>
        <Text className="text-[15px]" style={{ color: SECONDARY }}>
          {formatScheduledSweepTime(sweep.eligibleAfter)}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={onExecute}
          style={({ pressed }) => [
            styles.executeButton,
            (pressed || disabled) && styles.executeButtonMuted,
          ]}
        >
          <Text className="text-[14px] font-medium text-white">
            {buttonLabel}
          </Text>
        </Pressable>
      </View>
      <View className="ml-3 items-end">
        <Text className="text-[17px] text-black">
          {formatScheduledSweepAmount(sweep.remainingAmountRaw)}
        </Text>
        <Text className="text-[13px]" style={{ color: SECONDARY }}>
          Main → Earn
        </Text>
      </View>
    </View>
  );
}

export function EarnActivityList({ limit }: { limit: number }) {
  const {
    earnTransactions,
    hasLoadedEarn,
    earnScheduledSweeps,
    isExecutingSweep,
    executeScheduledSweep,
  } = useActivity();
  const hasScheduled = earnScheduledSweeps.length > 0;

  // Skeleton only on the cold load (before the first fetch settles). Background
  // 15s polls keep the feed fresh without flashing the skeleton on each tick.
  if (!hasLoadedEarn && earnTransactions.length === 0 && !hasScheduled) {
    return (
      <View className="px-4">
        {[1, 2, 3].map((i) => (
          <View key={i} className="flex-row items-center px-4 py-2.5">
            <View
              className="h-12 w-12 rounded-full"
              style={{ backgroundColor: "#f2f2f7" }}
            />
            <View className="ml-3 flex-1">
              <View
                className="mb-1 h-4 w-24 rounded"
                style={{ backgroundColor: "#f2f2f7" }}
              />
              <View
                className="h-3 w-28 rounded"
                style={{ backgroundColor: "#f2f2f7" }}
              />
            </View>
            <View className="items-end">
              <View
                className="mb-1 h-4 w-20 rounded"
                style={{ backgroundColor: "#f2f2f7" }}
              />
              <View
                className="h-3 w-12 rounded"
                style={{ backgroundColor: "#f2f2f7" }}
              />
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (earnTransactions.length === 0 && !hasScheduled) {
    return (
      <View className="items-center px-4 py-12">
        <Text className="text-[17px] font-medium text-black">
          No transactions yet
        </Text>
        <Text
          className="mt-1 text-[15px]"
          style={{ color: SECONDARY, textAlign: "center" }}
        >
          Earn deposits and withdrawals will appear here.
        </Text>
      </View>
    );
  }

  // Only render up to `limit` rows — the parent grows this on scroll. Rendering
  // the full history at once blocks the tab switch (non-virtualized ScrollView).
  const groups = groupEarnTransactions(earnTransactions.slice(0, limit));

  return (
    <View>
      {hasScheduled ? (
        <View>
          <Text
            className="px-4 pb-2 pt-3 text-[17px]"
            style={{ color: SECONDARY, letterSpacing: -0.187 }}
          >
            Scheduled
          </Text>
          {earnScheduledSweeps.map((sweep) => (
            <EarnScheduledRow
              key={sweep.id}
              sweep={sweep}
              isExecuting={isExecutingSweep}
              onExecute={executeScheduledSweep}
            />
          ))}
        </View>
      ) : null}
      {groups.map((group) => (
        <View key={group.date}>
          <Text
            className="px-4 pb-2 pt-3 text-[17px]"
            style={{ color: SECONDARY, letterSpacing: -0.187 }}
          >
            {group.date}
          </Text>
          {group.items.map((item) => (
            <EarnTransactionRow key={item.id} item={item} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  executeButton: {
    alignSelf: "flex-start",
    marginTop: 8,
    backgroundColor: BRAND_RED,
    borderRadius: 9999,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  executeButtonMuted: {
    opacity: 0.6,
  },
});
