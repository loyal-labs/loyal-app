import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Shield, ShieldOff } from "lucide-react-native";
import { Image as RNImage, StyleSheet } from "react-native";

import type { TokenDetailsByMint } from "@/hooks/wallet/useTokenDetails";
import { NATIVE_SOL_MINT } from "@/lib/solana/constants";
import {
  resolveTokenIcon,
  resolveTokenSymbol,
} from "@/lib/solana/token-holdings/resolve-token-info";
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
  tokenDetailsByMint: TokenDetailsByMint;
  isLoading: boolean;
  onTransactionPress: (transaction: Transaction) => void;
  onShowAll: () => void;
  maxItems?: number;
};

function TokenAvatar({ uri }: { uri: string }) {
  return (
    <RNImage
      source={{ uri }}
      style={{ width: 48, height: 48, borderRadius: 24 }}
    />
  );
}

function ShieldedBadge() {
  return (
    <View style={[styles.iconCircle, { backgroundColor: "#dbeafe" }]}>
      <Shield size={26} color="#2563eb" strokeWidth={2} />
    </View>
  );
}

function UnshieldedBadge() {
  return (
    <View style={[styles.iconCircle, { backgroundColor: "#ffedd5" }]}>
      <ShieldOff size={26} color="#ea580c" strokeWidth={2} />
    </View>
  );
}

const styles = StyleSheet.create({
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});

function TransactionRow({
  transaction,
  tokenHoldings,
  tokenDetailsByMint,
  onPress,
}: {
  transaction: Transaction;
  tokenHoldings: TokenHolding[];
  tokenDetailsByMint: TokenDetailsByMint;
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
      transaction.swapFromSymbol ||
      (transaction.swapFromMint
        ? resolveTokenSymbol({
            mint: transaction.swapFromMint,
            detailSymbol: tokenDetailsByMint[transaction.swapFromMint]?.token.symbol,
            holdingSymbol: swapFromHolding?.symbol,
          })
        : "?");
    const swapToSymbol =
      transaction.swapToSymbol ||
      (transaction.swapToMint
        ? resolveTokenSymbol({
            mint: transaction.swapToMint,
            detailSymbol: tokenDetailsByMint[transaction.swapToMint]?.token.symbol,
            holdingSymbol: swapToHolding?.symbol,
          })
        : "?");
    const swapToAmount = transaction.swapToAmount;
    const swapToIcon = transaction.swapToMint
      ? resolveTokenIcon({
          mint: transaction.swapToMint,
          imageUrl: swapToHolding?.imageUrl,
          detailLogoUrl: tokenDetailsByMint[transaction.swapToMint]?.token.logoUrl,
        })
      : null;

    return (
      <Pressable
        onPress={onPress}
        className="flex-row items-center px-4 py-2.5"
      >
        {swapToIcon ? <TokenAvatar uri={swapToIcon} /> : <View style={styles.iconCircle} />}
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
      transaction.secureTokenSymbol ||
      (transaction.tokenMint
        ? resolveTokenSymbol({
            mint: transaction.tokenMint,
            detailSymbol: tokenDetailsByMint[transaction.tokenMint]?.token.symbol,
            holdingSymbol: secureHolding?.symbol,
          })
        : "Token");
    const secureAmount =
      transaction.secureAmount ??
      (transaction.tokenAmount ? parseFloat(transaction.tokenAmount) : null);

    return (
      <Pressable
        onPress={onPress}
        className="flex-row items-center px-4 py-2.5"
      >
        {isSecure ? <ShieldedBadge /> : <UnshieldedBadge />}
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
  const amountColor = isIncoming ? "#34c759" : "#000";
  const directionSign = isIncoming ? "+" : "\u2212";

  // Token transfer display
  if (transaction.tokenMint && transaction.tokenAmount) {
    const holding = tokenHoldings.find(
      (h) => h.mint === transaction.tokenMint,
    );
    const detail = tokenDetailsByMint[transaction.tokenMint];
    const symbol = resolveTokenSymbol({
      mint: transaction.tokenMint,
      detailSymbol: detail?.token.symbol,
      holdingSymbol: holding?.symbol,
    });
    const icon = resolveTokenIcon({
      mint: transaction.tokenMint,
      imageUrl: holding?.imageUrl,
      detailLogoUrl: detail?.token.logoUrl,
    });

    return (
      <Pressable
        onPress={onPress}
        className="flex-row items-center px-4 py-2.5"
      >
        <TokenAvatar uri={icon} />
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
            {directionSign}
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

  // Native SOL transfer: keep the existing zero-guard since amountLamports is
  // the actual transferred amount here.
  const solPrefix = isEffectivelyZero ? "" : directionSign;
  const solHolding = tokenHoldings.find((h) => h.mint === NATIVE_SOL_MINT);
  const solIcon = resolveTokenIcon({
    mint: NATIVE_SOL_MINT,
    imageUrl: solHolding?.imageUrl,
    detailLogoUrl: tokenDetailsByMint[NATIVE_SOL_MINT]?.token.logoUrl,
  });
  return (
    <Pressable onPress={onPress} className="flex-row items-center px-4 py-2.5">
      <TokenAvatar uri={solIcon} />
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
          {solPrefix}
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
  tokenDetailsByMint,
  isLoading,
  onTransactionPress,
  onShowAll,
  maxItems = 6,
}: ActivityFeedProps) {
  const displayTransactions = transactions.slice(0, maxItems);

  if (isLoading && transactions.length === 0) {
    return (
      <View className="px-4">
        <Text
          className="pb-2 pt-3 text-[17px] font-medium text-black"
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
      <View className="px-4">
        <Text
          className="pb-2 pt-3 text-[17px] font-medium text-black"
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

  const showSeeAll = transactions.length > maxItems;

  return (
    <View className="px-4">
      <View style={{ position: "relative" }}>
        <Text
          className="pb-2 pt-3 text-[17px] font-medium text-black"
          style={{ letterSpacing: -0.176 }}
        >
          Activity
        </Text>
        {showSeeAll ? (
          <Pressable
            onPress={onShowAll}
            hitSlop={8}
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              justifyContent: "center",
            }}
          >
            {({ pressed }) => (
              <Text
                className="text-[17px]"
                style={{ color: "#F9363C", opacity: pressed ? 0.7 : 1 }}
              >
                See All
              </Text>
            )}
          </Pressable>
        ) : null}
      </View>
      {displayTransactions.map((tx) => (
        <TransactionRow
          key={tx.id}
          transaction={tx}
          tokenHoldings={tokenHoldings}
          tokenDetailsByMint={tokenDetailsByMint}
          onPress={() => onTransactionPress(tx)}
        />
      ))}
    </View>
  );
}
