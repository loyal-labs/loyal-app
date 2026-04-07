import {
  BottomSheetFlatList,
  BottomSheetModal,
} from "@gorhom/bottom-sheet";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Shield,
  ShieldOff,
} from "lucide-react-native";
import { forwardRef, useCallback, useMemo } from "react";
import { Image as RNImage } from "react-native";

import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import {
  formatSenderAddress,
  formatTransactionAmount,
  formatTransactionDate,
} from "@/lib/solana/wallet/formatters";
import { Pressable, Text, View } from "@/tw";
import type { Transaction } from "@/types/wallet";

type ActivitySheetProps = {
  transactions: Transaction[];
  tokenHoldings: TokenHolding[];
  onTransactionPress: (transaction: Transaction) => void;
};

function TransactionRow({
  transaction,
  tokenHoldings,
  onPress,
}: {
  transaction: Transaction;
  tokenHoldings: TokenHolding[];
  onPress: () => void;
}) {
  const isIncoming = transaction.type === "incoming";
  const isSwap = transaction.transferType === "swap";
  const isSecure = transaction.transferType === "secure";
  const isUnshield = transaction.transferType === "unshield";
  const isCompact =
    transaction.transferType === "store" ||
    transaction.transferType === "verify_telegram_init_data";

  const counterparty = isIncoming
    ? transaction.sender || "Unknown sender"
    : transaction.recipient || "Unknown recipient";
  const formattedCounterparty = counterparty.startsWith("@")
    ? counterparty
    : formatSenderAddress(counterparty);
  const isEffectivelyZero =
    Math.abs(transaction.amountLamports) < LAMPORTS_PER_SOL / 10000;

  let iconElement: React.ReactNode;
  let title: string;
  let subtitle: string | null = null;
  let amount: string;
  let amountColor = "#000";

  if (isCompact) {
    title =
      transaction.transferType === "store" ? "Store data" : "Verify data";
    amount = formatTransactionDate(transaction.timestamp);

    return (
      <Pressable onPress={onPress} className="flex-row items-center px-4 py-2">
        <Text
          className="flex-1 text-[13px]"
          style={{ color: "rgba(60, 60, 67, 0.6)" }}
        >
          {title}
        </Text>
        <Text
          className="text-[13px]"
          style={{ color: "rgba(60, 60, 67, 0.6)" }}
        >
          {amount}
        </Text>
      </Pressable>
    );
  }

  if (isSwap) {
    const swapToHolding = transaction.swapToMint
      ? tokenHoldings.find((h) => h.mint === transaction.swapToMint)
      : undefined;
    const swapFromHolding = transaction.swapFromMint
      ? tokenHoldings.find((h) => h.mint === transaction.swapFromMint)
      : undefined;
    const fromSymbol =
      transaction.swapFromSymbol || swapFromHolding?.symbol || "?";
    const toSymbol =
      transaction.swapToSymbol || swapToHolding?.symbol || "?";
    iconElement = (
      <View className="h-12 w-12 items-center justify-center rounded-full bg-purple-100">
        <ArrowLeftRight size={28} color="#9333ea" strokeWidth={1.5} />
      </View>
    );
    title = "Swap";
    subtitle = `${fromSymbol} to ${toSymbol}`;
    amountColor = "#32e55e";
    amount =
      transaction.swapToAmount != null
        ? `+${transaction.swapToAmount.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${toSymbol}`
        : "Swap";
  } else if (isSecure || isUnshield) {
    const secureHolding = transaction.tokenMint
      ? tokenHoldings.find((h) => h.mint === transaction.tokenMint)
      : undefined;
    const symbol =
      transaction.secureTokenSymbol || secureHolding?.symbol || "Token";
    const secureAmount =
      transaction.secureAmount ??
      (transaction.tokenAmount ? parseFloat(transaction.tokenAmount) : null);
    iconElement = isSecure ? (
      <View className="h-12 w-12 items-center justify-center rounded-full bg-blue-100">
        <Shield size={28} color="#2563eb" strokeWidth={1.5} />
      </View>
    ) : (
      <View className="h-12 w-12 items-center justify-center rounded-full bg-orange-100">
        <ShieldOff size={28} color="#ea580c" strokeWidth={1.5} />
      </View>
    );
    title = isSecure ? "Shielded" : "Unshielded";
    subtitle = symbol;
    amount =
      secureAmount != null
        ? `${secureAmount.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${symbol}`
        : `${formatTransactionAmount(transaction.amountLamports)} SOL`;
  } else if (transaction.tokenMint && transaction.tokenAmount) {
    const holding = tokenHoldings.find(
      (h) => h.mint === transaction.tokenMint,
    );
    const symbol = holding?.symbol || "Token";
    const icon = resolveTokenIcon({
      mint: transaction.tokenMint,
      imageUrl: holding?.imageUrl,
    });
    iconElement = (
      <RNImage
        source={{ uri: icon }}
        style={{ width: 48, height: 48, borderRadius: 24 }}
      />
    );
    title = isIncoming ? "Received" : "Sent";
    subtitle = `${isIncoming ? "from" : "to"} ${formattedCounterparty}`;
    amountColor = isIncoming ? "#32e55e" : "#000";
    const prefix = isIncoming ? "+" : "\u2212";
    amount = `${prefix}${transaction.tokenAmount} ${symbol}`;
  } else {
    iconElement = isIncoming ? (
      <View
        className="h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: "rgba(50, 229, 94, 0.15)" }}
      >
        <ArrowDown size={28} color="#32e55e" strokeWidth={1.5} />
      </View>
    ) : (
      <View
        className="h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: "rgba(249, 54, 60, 0.14)" }}
      >
        <ArrowUp size={28} color="#000" strokeWidth={1.5} />
      </View>
    );
    title = isIncoming ? "Received" : "Sent";
    if (!counterparty.toLowerCase().startsWith("unknown recipient")) {
      subtitle = `${isIncoming ? "from" : "to"} ${formattedCounterparty}`;
    }
    amountColor = isIncoming ? "#32e55e" : "#000";
    const prefix = isEffectivelyZero ? "" : isIncoming ? "+" : "\u2212";
    amount = `${prefix}${isEffectivelyZero ? "0" : formatTransactionAmount(transaction.amountLamports)} SOL`;
  }

  return (
    <Pressable onPress={onPress} className="flex-row items-center px-4 py-2.5">
      {iconElement}
      <View className="ml-3 flex-1">
        <Text className="text-[16px] font-medium text-black">{title}</Text>
        {subtitle && (
          <Text
            className="text-[13px]"
            style={{ color: "rgba(60, 60, 67, 0.6)" }}
          >
            {subtitle}
          </Text>
        )}
      </View>
      <View className="items-end">
        <Text className="text-[16px] font-medium" style={{ color: amountColor }}>
          {amount}
        </Text>
        <Text
          className="text-[13px]"
          style={{ color: "rgba(60, 60, 67, 0.6)" }}
        >
          {formatTransactionDate(transaction.timestamp)}
        </Text>
      </View>
    </Pressable>
  );
}

export const ActivitySheet = forwardRef<BottomSheetModal, ActivitySheetProps>(
  function ActivitySheet({ transactions, tokenHoldings, onTransactionPress }, ref) {
    const snapPoints = useMemo(() => ["70%", "90%"], []);

    const renderItem = useCallback(
      ({ item }: { item: Transaction }) => (
        <TransactionRow
          transaction={item}
          tokenHoldings={tokenHoldings}
          onPress={() => onTransactionPress(item)}
        />
      ),
      [tokenHoldings, onTransactionPress],
    );

    const keyExtractor = useCallback(
      (item: Transaction) => item.id,
      [],
    );

    const listHeader = useMemo(
      () => (
        <View className="px-4 pb-2 pt-1">
          <Text
            className="text-[17px] font-semibold text-black"
            style={{ lineHeight: 22 }}
          >
            All Activity
          </Text>
          <Text
            className="text-[13px]"
            style={{ color: "rgba(60, 60, 67, 0.6)" }}
          >
            {transactions.length} transaction
            {transactions.length !== 1 ? "s" : ""}
          </Text>
        </View>
      ),
      [transactions.length],
    );

    return (
      <BottomSheetModal
        ref={ref}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
      >
        <BottomSheetFlatList
          data={transactions}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ListHeaderComponent={listHeader}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      </BottomSheetModal>
    );
  },
);
