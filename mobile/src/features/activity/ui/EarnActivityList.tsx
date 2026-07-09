import { useEffect, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import Animated, {
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

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

import {
  type EarnRefundItem,
  type SweepMorph,
  useActivity,
} from "../model/ActivityProvider";
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
  forceExecuting = false,
}: {
  sweep: EarnAutodepositScheduledSweep;
  isExecuting: boolean;
  onExecute: () => void;
  // True once the sweep has been kicked off and we're waiting on its result tx,
  // even after it drops out of the live pending list — keeps the row showing
  // "Executing…" (disabled) instead of falling back to "Execute now".
  forceExecuting?: boolean;
}) {
  const awaiting = forceExecuting || isScheduledSweepAwaitingExecution(sweep);
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

// Placeholder mirroring EarnScheduledRow's geometry, shown the instant the user
// lands here after creating an Autodeposit — the provider's own Autodeposit
// read is still catching up, and an empty slot reads as "nothing happened".
function EarnScheduledSkeletonRow() {
  return (
    <View className="flex-row items-start px-4 py-2.5">
      <View
        className="h-12 w-12 rounded-full"
        style={{ backgroundColor: "#f2f2f7" }}
      />
      <View className="ml-3 flex-1">
        <View
          className="h-4 w-28 rounded"
          style={{ backgroundColor: "#f2f2f7" }}
        />
        <View
          className="mt-1.5 h-3.5 w-40 rounded"
          style={{ backgroundColor: "#f2f2f7" }}
        />
        <View
          className="mt-2 h-[30px] w-28 rounded-full"
          style={{ backgroundColor: "#f2f2f7" }}
        />
      </View>
      <View className="ml-3 items-end">
        <View
          className="h-4 w-16 rounded"
          style={{ backgroundColor: "#f2f2f7" }}
        />
        <View
          className="mt-1 h-3 w-20 rounded"
          style={{ backgroundColor: "#f2f2f7" }}
        />
      </View>
    </View>
  );
}

function formatRefundSol(lamports: number): string {
  return (lamports / 1e9).toFixed(4).replace(/\.?0+$/, "");
}

const REFUND_SUBTITLES: Record<EarnRefundItem["kind"], string> = {
  policy: "Earn policy rent",
  recurring_delegation: "Earn allowance rent",
  vault: "Earn account rent",
};

// A refundable closed Earn account: rent we can return to the
// wallet. Funds flow Earn -> Main, so it shows the withdraw icon.
function EarnRefundRow({
  item,
  isRefunding,
  onRefund,
}: {
  item: EarnRefundItem;
  isRefunding: boolean;
  onRefund: () => void;
}) {
  return (
    <View className="flex-row items-start px-4 py-2.5">
      <EarnTxCompoundIcon item={{ kind: "withdraw" }} />
      <View className="ml-3 flex-1">
        <Text className="text-[17px] font-medium text-black">Refund</Text>
        <Text className="text-[15px]" style={{ color: SECONDARY }}>
          {REFUND_SUBTITLES[item.kind]}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={isRefunding}
          onPress={onRefund}
          style={({ pressed }) => [
            styles.executeButton,
            (pressed || isRefunding) && styles.executeButtonMuted,
          ]}
        >
          <Text className="text-[14px] font-medium text-white">
            {isRefunding ? "Refunding…" : "Refund"}
          </Text>
        </Pressable>
      </View>
      <View className="ml-3 items-end">
        <Text className="text-[17px] text-black">
          +{formatRefundSol(item.lamports)} SOL
        </Text>
        <Text className="text-[13px]" style={{ color: SECONDARY }}>
          Earn → Main
        </Text>
      </View>
    </View>
  );
}

// Rent the refund scan reports as blocked by the wallet's Autodeposit. Not
// actionable here — it becomes refundable the moment the Autodeposit is
// deleted — but showing it stops "my SOL is stuck" reports for rent that is
// one delete away.
function EarnLockedRefundRow({ lamports }: { lamports: number }) {
  return (
    <View className="flex-row items-start px-4 py-2.5">
      <EarnTxCompoundIcon item={{ kind: "withdraw" }} />
      <View className="ml-3 flex-1">
        <Text className="text-[17px] font-medium text-black">Reserved</Text>
        <Text className="text-[15px]" style={{ color: SECONDARY }}>
          Held while Autodeposit is set up. Delete Autodeposit to refund it.
        </Text>
      </View>
      <View className="ml-3 items-end">
        <Text className="text-[17px] text-black">
          {formatRefundSol(lamports)} SOL
        </Text>
        <Text className="text-[13px]" style={{ color: SECONDARY }}>
          Locked
        </Text>
      </View>
    </View>
  );
}

const noop = () => {};

// Renders an executed sweep morphing in place into its result tx. Holds the
// "executing" face (Scheduled header + executing row) until the worker's
// `balance_sweep` tx lands, then cross-dissolves to that tx row: fade out → swap
// content while invisible (so the height change between the tall executing row
// and the short tx row doesn't jump) → fade back in.
function SweepMorphSection({
  morph,
  isRequesting,
}: {
  morph: SweepMorph;
  isRequesting: boolean;
}) {
  const opacity = useSharedValue(1);
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    if (morph.resultTx && !showResult) {
      opacity.value = withTiming(0, { duration: 220 }, (finished) => {
        if (finished) {
          runOnJS(setShowResult)(true);
        }
      });
    }
  }, [morph.resultTx, showResult, opacity]);

  useEffect(() => {
    if (showResult) {
      opacity.value = withTiming(1, { duration: 260 });
    }
  }, [showResult, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    // `layout` animates the height collapse when the tall executing row swaps for
    // the short result row, so the feed below glides up instead of snapping.
    <Animated.View style={animatedStyle} layout={LinearTransition.duration(260)}>

      {showResult && morph.resultTx ? (
        <EarnTransactionRow item={morph.resultTx} />
      ) : (
        <View>
          <Text
            className="px-4 pb-2 pt-3 text-[17px]"
            style={{ color: SECONDARY, letterSpacing: -0.187 }}
          >
            Scheduled
          </Text>
          {morph.sweeps.map((sweep) => (
            <EarnScheduledRow
              key={sweep.id}
              sweep={sweep}
              isExecuting={isRequesting}
              onExecute={noop}
              forceExecuting
            />
          ))}
        </View>
      )}
    </Animated.View>
  );
}

export function EarnActivityList({ limit }: { limit: number }) {
  const {
    earnTransactions,
    hasLoadedEarn,
    earnScheduledSweeps,
    isExecutingSweep,
    executeScheduledSweep,
    expectingScheduledSweep,
    sweepMorph,
    earnRefunds,
    earnLockedRefundLamports,
    refundingAccount,
    executeRefund,
  } = useActivity();
  // While a morph is in progress it owns the top slot (the executed sweeps), so
  // suppress the live "Scheduled" section to avoid rendering the same row twice.
  const hasScheduled = !sweepMorph && earnScheduledSweeps.length > 0;
  const hasRefunds = earnRefunds.length > 0;
  const hasLockedRefunds = earnLockedRefundLamports > 0;
  // A just-created Autodeposit's sweep is on its way but the provider's read
  // hasn't caught up — hold its slot with a skeleton so the user who was just
  // routed here sees the row forming instead of an unchanged feed.
  const showScheduledSkeleton =
    expectingScheduledSweep && !hasScheduled && !sweepMorph;

  // Skeleton only on the cold load (before the first fetch settles). Background
  // 15s polls keep the feed fresh without flashing the skeleton on each tick.
  if (
    !hasLoadedEarn &&
    earnTransactions.length === 0 &&
    !hasScheduled &&
    !sweepMorph &&
    !hasRefunds &&
    !hasLockedRefunds &&
    !showScheduledSkeleton
  ) {
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

  if (
    earnTransactions.length === 0 &&
    !hasScheduled &&
    !sweepMorph &&
    !hasRefunds &&
    !hasLockedRefunds &&
    !showScheduledSkeleton
  ) {
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

  // The morph renders the result tx itself (pinned at the top), so drop it from
  // the date groups to avoid showing it twice. Filter before slicing so it
  // doesn't consume a render-window slot.
  const morphResultId = sweepMorph?.resultTx?.id;
  const groupedTxns = morphResultId
    ? earnTransactions.filter((tx) => tx.id !== morphResultId)
    : earnTransactions;
  // Only render up to `limit` rows — the parent grows this on scroll. Rendering
  // the full history at once blocks the tab switch (non-virtualized ScrollView).
  const groups = groupEarnTransactions(groupedTxns.slice(0, limit));

  return (
    <View>
      {hasRefunds || hasLockedRefunds ? (
        <View>
          <Text
            className="px-4 pb-2 pt-3 text-[17px]"
            style={{ color: SECONDARY, letterSpacing: -0.187 }}
          >
            Refunds
          </Text>
          {earnRefunds.map((refund) => (
            <EarnRefundRow
              key={refund.account}
              item={refund}
              isRefunding={refundingAccount === refund.account}
              onRefund={() => void executeRefund(refund)}
            />
          ))}
          {hasLockedRefunds ? (
            <EarnLockedRefundRow lamports={earnLockedRefundLamports} />
          ) : null}
        </View>
      ) : null}
      {sweepMorph ? (
        <SweepMorphSection
          key={sweepMorph.startedAtMs}
          morph={sweepMorph}
          isRequesting={isExecutingSweep}
        />
      ) : hasScheduled ? (
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
      ) : showScheduledSkeleton ? (
        <View>
          <Text
            className="px-4 pb-2 pt-3 text-[17px]"
            style={{ color: SECONDARY, letterSpacing: -0.187 }}
          >
            Scheduled
          </Text>
          <EarnScheduledSkeletonRow />
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
