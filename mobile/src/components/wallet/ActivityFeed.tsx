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
      <View className="h-10 w-10 items-center justify-center rounded-full bg-purple-100">
        <ArrowLeftRight size={20} color="#9333ea" strokeWidth={1.5} />
      </View>
    );
  }

  if (isSecure) {
    return (
      <View className="h-10 w-10 items-center justify-center rounded-full bg-blue-100">
        <Shield size={20} color="#2563eb" strokeWidth={1.5} />
      </View>
    );
  }

  if (isUnshield) {
    return (
      <View className="h-10 w-10 items-center justify-center rounded-full bg-orange-100">
        <ShieldOff size={20} color="#ea580c" strokeWidth={1.5} />
      </View>
    );
  }

  if (isIncoming) {
    return (
      <View
        className="h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: "rgba(50, 229, 94, 0.15)" }}
      >
        <ArrowDown size={20} color="#32e55e" strokeWidth={1.5} />
      </View>
    );
  }

  return (
    <View className="h-10 w-10 items-center justify-center rounded-full bg-neutral-100">
      <ArrowUp size={20} color="#000" strokeWidth={1.5} />
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
        <Text className="flex-1 text-sm text-neutral-400">{label}</Text>
        <Text className="text-xs text-neutral-400">
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
        className="flex-row items-center px-4 py-3"
      >
        <TransactionIcon transaction={transaction} />
        <View className="ml-3 flex-1">
          <Text className="text-sm font-medium text-black">Swap</Text>
          <Text className="text-xs text-neutral-500">
            {swapFromSymbol} to {swapToSymbol}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-sm font-medium" style={{ color: "#32e55e" }}>
            {swapToAmount != null
              ? `+${swapToAmount.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${swapToSymbol}`
              : "Swap"}
          </Text>
          <Text className="text-xs text-neutral-400">
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
        className="flex-row items-center px-4 py-3"
      >
        <TransactionIcon transaction={transaction} />
        <View className="ml-3 flex-1">
          <Text className="text-sm font-medium text-black">
            {isSecure ? "Shielded" : "Unshielded"}
          </Text>
          <Text className="text-xs text-neutral-500">{secureSymbol}</Text>
        </View>
        <View className="items-end">
          <Text className="text-sm font-medium text-black">
            {secureAmount != null
              ? `${secureAmount.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${secureSymbol}`
              : `${formatTransactionAmount(transaction.amountLamports)} SOL`}
          </Text>
          <Text className="text-xs text-neutral-400">
            {formatTransactionDate(transaction.timestamp)}
          </Text>
        </View>
      </Pressable>
    );
  }

  // Standard send/receive
  const amountPrefix = isEffectivelyZero ? "" : isIncoming ? "+" : "\u2212";
  const amountColor = isIncoming ? "#32e55e" : "#000";

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
        className="flex-row items-center px-4 py-3"
      >
        <RNImage
          source={{ uri: icon }}
          style={{ width: 40, height: 40, borderRadius: 20 }}
        />
        <View className="ml-3 flex-1">
          <Text className="text-sm font-medium text-black">
            {isIncoming ? "Received" : "Sent"}
          </Text>
          <Text className="text-xs text-neutral-500">
            {isIncoming ? "from" : "to"} {formattedCounterparty}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-sm font-medium" style={{ color: amountColor }}>
            {amountPrefix}
            {transaction.tokenAmount} {symbol}
          </Text>
          <Text className="text-xs text-neutral-400">
            {formatTransactionDate(transaction.timestamp)}
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} className="flex-row items-center px-4 py-3">
      <TransactionIcon transaction={transaction} />
      <View className="ml-3 flex-1">
        <Text className="text-sm font-medium text-black">
          {isIncoming ? "Received" : "Sent"}
        </Text>
        {!(counterparty.toLowerCase().startsWith("unknown recipient")) && (
          <Text className="text-xs text-neutral-500">
            {isIncoming ? "from" : "to"} {formattedCounterparty}
          </Text>
        )}
      </View>
      <View className="items-end">
        <Text className="text-sm font-medium" style={{ color: amountColor }}>
          {amountPrefix}
          {isEffectivelyZero
            ? "0"
            : formatTransactionAmount(transaction.amountLamports)}{" "}
          SOL
        </Text>
        <Text className="text-xs text-neutral-400">
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
        <Text className="mb-2 px-4 text-sm font-semibold text-neutral-700">
          Activity
        </Text>
        {[1, 2, 3].map((i) => (
          <View key={i} className="flex-row items-center px-4 py-3">
            <View className="h-10 w-10 rounded-full bg-neutral-100" />
            <View className="ml-3 flex-1">
              <View className="mb-1 h-4 w-20 rounded bg-neutral-100" />
              <View className="h-3 w-28 rounded bg-neutral-100" />
            </View>
            <View className="items-end">
              <View className="mb-1 h-4 w-16 rounded bg-neutral-100" />
              <View className="h-3 w-12 rounded bg-neutral-100" />
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (transactions.length === 0) {
    return (
      <View>
        <Text className="mb-2 px-4 text-sm font-semibold text-neutral-700">
          Activity
        </Text>
        <View className="items-center px-4 py-8">
          <Text className="text-sm text-neutral-400">
            No transactions yet
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View>
      <Text className="mb-2 px-4 text-sm font-semibold text-neutral-700">
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
        <Pressable onPress={onShowAll} className="px-4 py-2">
          <Text className="text-center text-sm font-medium text-blue-500">
            See all {transactions.length} transactions
          </Text>
        </Pressable>
      )}
    </View>
  );
}
