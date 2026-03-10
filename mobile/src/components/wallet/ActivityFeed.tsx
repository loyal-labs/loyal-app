import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Shield,
  ShieldOff,
} from "lucide-react-native";
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

type ActivityFeedProps = {
  transactions: Transaction[];
  tokenHoldings: TokenHolding[];
  isLoading: boolean;
  onTransactionPress: (transaction: Transaction) => void;
  onShowAll: () => void;
  maxItems?: number;
};

function TransactionIcon({ transaction }: { transaction: Transaction }) {
  const isIncoming = transaction.type === "incoming";
  const isSwap = transaction.transferType === "swap";
  const isSecure = transaction.transferType === "secure";
  const isUnshield = transaction.transferType === "unshield";

  if (isSwap) {
    return (
      <View className="h-12 w-12 items-center justify-center rounded-full bg-purple-100">
        <ArrowLeftRight size={28} color="#9333ea" strokeWidth={1.5} />
      </View>
    );
  }

  if (isSecure) {
    return (
      <View className="h-12 w-12 items-center justify-center rounded-full bg-blue-100">
        <Shield size={28} color="#2563eb" strokeWidth={1.5} />
      </View>
    );
  }

  if (isUnshield) {
    return (
      <View className="h-12 w-12 items-center justify-center rounded-full bg-orange-100">
        <ShieldOff size={28} color="#ea580c" strokeWidth={1.5} />
      </View>
    );
  }

  if (isIncoming) {
    return (
      <View
        className="h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: "rgba(50, 229, 94, 0.15)" }}
      >
        <ArrowDown size={28} color="#34c759" strokeWidth={1.5} />
      </View>
    );
  }

  // Outgoing
  return (
    <View
      className="h-12 w-12 items-center justify-center rounded-full"
      style={{ backgroundColor: "rgba(249, 54, 60, 0.14)" }}
    >
      <ArrowUp size={28} color="#000" strokeWidth={1.5} />
    </View>
  );
}

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

  if (isCompact) {
    const label =
      transaction.transferType === "store" ? "Store data" : "Verify data";
    return (
      <Pressable
        onPress={onPress}
        className="flex-row items-center px-4 py-2"
      >
        <Text
          className="flex-1 text-[13px]"
          style={{ color: "rgba(60, 60, 67, 0.6)" }}
        >
          {label}
        </Text>
        <Text
          className="text-[13px]"
          style={{ color: "rgba(60, 60, 67, 0.6)" }}
        >
          {formatTransactionDate(transaction.timestamp)}
        </Text>
      </Pressable>
    );
  }

  if (isSwap) {
    const swapFromHolding = transaction.swapFromMint
      ? tokenHoldings.find((h) => h.mint === transaction.swapFromMint)
      : undefined;
    const swapToHolding = transaction.swapToMint
      ? tokenHoldings.find((h) => h.mint === transaction.swapToMint)
      : undefined;
    const swapFromSymbol =
      transaction.swapFromSymbol || swapFromHolding?.symbol || "?";
    const swapToSymbol =
      transaction.swapToSymbol || swapToHolding?.symbol || "?";
    const swapToAmount = transaction.swapToAmount;

    return (
      <Pressable
        onPress={onPress}
        className="flex-row items-center px-4 py-2.5"
      >
        <TransactionIcon transaction={transaction} />
        <View className="ml-3 flex-1">
          <Text className="text-[17px] font-medium text-black">Swap</Text>
          <Text
            className="text-[13px]"
            style={{ color: "rgba(60, 60, 67, 0.6)" }}
          >
            {swapFromSymbol} to {swapToSymbol}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-[17px]" style={{ color: "#34c759" }}>
            {swapToAmount != null
              ? `+${swapToAmount.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${swapToSymbol}`
              : "Swap"}
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

  if (isSecure || isUnshield) {
    const secureHolding = transaction.tokenMint
      ? tokenHoldings.find((h) => h.mint === transaction.tokenMint)
      : undefined;
    const secureSymbol =
      transaction.secureTokenSymbol || secureHolding?.symbol || "Token";
    const secureAmount =
      transaction.secureAmount ??
      (transaction.tokenAmount ? parseFloat(transaction.tokenAmount) : null);

    return (
      <Pressable
        onPress={onPress}
        className="flex-row items-center px-4 py-2.5"
      >
        <TransactionIcon transaction={transaction} />
        <View className="ml-3 flex-1">
          <Text className="text-[17px] font-medium text-black">
            {isSecure ? "Shielded" : "Unshielded"}
          </Text>
          <Text
            className="text-[13px]"
            style={{ color: "rgba(60, 60, 67, 0.6)" }}
          >
            {secureSymbol}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-[17px] font-medium text-black">
            {secureAmount != null
              ? `${secureAmount.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${secureSymbol}`
              : `${formatTransactionAmount(transaction.amountLamports)} SOL`}
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

  // Standard send/receive
  const amountPrefix = isEffectivelyZero ? "" : isIncoming ? "+" : "\u2212";
  const amountColor = isIncoming ? "#34c759" : "#000";

  // Token transfer display
  if (transaction.tokenMint && transaction.tokenAmount) {
    const holding = tokenHoldings.find(
      (h) => h.mint === transaction.tokenMint,
    );
    const symbol = holding?.symbol || "Token";
    const icon = resolveTokenIcon({
      mint: transaction.tokenMint,
      imageUrl: holding?.imageUrl,
    });

    return (
      <Pressable
        onPress={onPress}
        className="flex-row items-center px-4 py-2.5"
      >
        <RNImage
          source={{ uri: icon }}
          style={{ width: 48, height: 48, borderRadius: 24 }}
        />
        <View className="ml-3 flex-1">
          <Text className="text-[17px] font-medium text-black">
            {isIncoming ? "Received" : "Sent"}
          </Text>
          <Text
            className="text-[13px]"
            style={{ color: "rgba(60, 60, 67, 0.6)" }}
          >
            {isIncoming ? "from" : "to"} {formattedCounterparty}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-[17px]" style={{ color: amountColor }}>
            {amountPrefix}
            {transaction.tokenAmount} {symbol}
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

  return (
    <Pressable onPress={onPress} className="flex-row items-center px-4 py-2.5">
      <TransactionIcon transaction={transaction} />
      <View className="ml-3 flex-1">
        <Text className="text-[17px] font-medium text-black">
          {isIncoming ? "Received" : "Sent"}
        </Text>
        {!(counterparty.toLowerCase().startsWith("unknown recipient")) && (
          <Text
            className="text-[13px]"
            style={{ color: "rgba(60, 60, 67, 0.6)" }}
          >
            {isIncoming ? "from" : "to"} {formattedCounterparty}
          </Text>
        )}
      </View>
      <View className="items-end">
        <Text className="text-[17px]" style={{ color: amountColor }}>
          {amountPrefix}
          {isEffectivelyZero
            ? "0"
            : formatTransactionAmount(transaction.amountLamports)}{" "}
          SOL
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

export function ActivityFeed({
  transactions,
  tokenHoldings,
  isLoading,
  onTransactionPress,
  onShowAll,
  maxItems = 10,
}: ActivityFeedProps) {
  const displayTransactions = transactions.slice(0, maxItems);

  if (isLoading && transactions.length === 0) {
    return (
      <View>
        <Text
          className="px-3 pb-2 pt-3 text-[17px] font-medium text-black"
          style={{ letterSpacing: -0.176 }}
        >
          Activity
        </Text>
        {[1, 2, 3].map((i) => (
          <View key={i} className="flex-row items-center px-4 py-2.5">
            <View className="h-12 w-12 rounded-full" style={{ backgroundColor: "#f2f2f7" }} />
            <View className="ml-3 flex-1">
              <View className="mb-1 h-4 w-20 rounded" style={{ backgroundColor: "#f2f2f7" }} />
              <View className="h-3 w-28 rounded" style={{ backgroundColor: "#f2f2f7" }} />
            </View>
            <View className="items-end">
              <View className="mb-1 h-4 w-16 rounded" style={{ backgroundColor: "#f2f2f7" }} />
              <View className="h-3 w-12 rounded" style={{ backgroundColor: "#f2f2f7" }} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (transactions.length === 0) {
    return (
      <View>
        <Text
          className="px-3 pb-2 pt-3 text-[17px] font-medium text-black"
          style={{ letterSpacing: -0.176 }}
        >
          Activity
        </Text>
        <View className="items-center px-4 py-8">
          <Text
            className="text-[15px]"
            style={{ color: "rgba(60, 60, 67, 0.6)" }}
          >
            No transactions yet
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View>
      <Text
        className="px-3 pb-2 pt-3 text-[17px] font-medium text-black"
        style={{ letterSpacing: -0.176 }}
      >
        Activity
      </Text>
      {displayTransactions.map((tx) => (
        <TransactionRow
          key={tx.id}
          transaction={tx}
          tokenHoldings={tokenHoldings}
          onPress={() => onTransactionPress(tx)}
        />
      ))}
      {transactions.length > maxItems && (
        <View className="mt-2 items-center px-3">
          <Pressable
            onPress={onShowAll}
            className="flex-row items-center gap-1.5 rounded-full px-4 py-1.5"
            style={{ backgroundColor: "rgba(249, 54, 60, 0.14)" }}
          >
            <Text className="text-[15px] text-black">
              Show All
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
