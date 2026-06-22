import { Image, StyleSheet } from "react-native";

import type { EarnTransactionItem } from "@/lib/solana/earn/earn-api";
import {
  getEarnTransactionAmountColor,
  getEarnTransactionRowLabel,
  groupEarnTransactions,
} from "@/lib/solana/earn/earn-tx-display";
import { Text, View } from "@/tw";

import { useActivity } from "../model/ActivityProvider";

const SECONDARY = "rgba(60, 60, 67, 0.6)";

const USDC_ICON = require("../../../../assets/images/earn/usdc.png");
const KAMINO_ICON = require("../../../../assets/images/earn/venues/earn-kamino.png");

// Reads source (back, top-left) -> destination (front, bottom-right): deposits
// flow USDC -> Kamino, withdrawals flow Kamino -> USDC. Mirrors the web pane's
// CompoundIcon; allowance actions move no funds, so they show a single coin.
function EarnTxIcon({ kind }: { kind: EarnTransactionItem["kind"] }) {
  if (kind === "autodeposit_action") {
    return (
      <View style={styles.iconWrap}>
        <Image source={KAMINO_ICON} style={styles.iconSingle} />
      </View>
    );
  }

  const isWithdraw = kind === "withdraw";
  const back = isWithdraw ? KAMINO_ICON : USDC_ICON;
  const front = isWithdraw ? USDC_ICON : KAMINO_ICON;

  return (
    <View style={styles.iconWrap}>
      <Image source={back} style={styles.iconBack} />
      <Image source={front} style={styles.iconFront} />
    </View>
  );
}

function EarnTransactionRow({ item }: { item: EarnTransactionItem }) {
  const label = getEarnTransactionRowLabel(item);
  const amountColor = getEarnTransactionAmountColor(item.kind);

  return (
    <View className="flex-row items-center px-4 py-2.5">
      <EarnTxIcon kind={item.kind} />
      <View className="ml-3 flex-1">
        <Text className="text-[17px] font-medium text-black">{label}</Text>
        <Text className="text-[13px]" style={{ color: SECONDARY }}>
          {item.source.label} → {item.destination.label}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-[17px]" style={{ color: amountColor }}>
          {item.amount}
        </Text>
        <Text className="text-[13px]" style={{ color: SECONDARY }}>
          {item.timestamp}
        </Text>
      </View>
    </View>
  );
}

export function EarnActivityList() {
  const { earnTransactions, isFetchingEarn } = useActivity();

  if (isFetchingEarn && earnTransactions.length === 0) {
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

  if (earnTransactions.length === 0) {
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

  const groups = groupEarnTransactions(earnTransactions);

  return (
    <View>
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
  iconWrap: {
    width: 48,
    height: 48,
    position: "relative",
  },
  iconSingle: {
    position: "absolute",
    top: 8,
    left: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  iconBack: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2.286,
    borderColor: "#ffffff",
  },
  iconFront: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
  },
});
