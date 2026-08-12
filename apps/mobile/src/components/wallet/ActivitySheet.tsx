import {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  BottomSheetModal,
} from "@gorhom/bottom-sheet";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Shield, ShieldOff } from "lucide-react-native";
import { forwardRef, useCallback, useMemo } from "react";
import { Image as RNImage } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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

type ActivitySheetProps = {
  transactions: Transaction[];
  tokenHoldings: TokenHolding[];
  tokenDetailsByMint: TokenDetailsByMint;
  onTransactionPress: (transaction: Transaction) => void;
};

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
      transaction.swapFromSymbol ||
      (transaction.swapFromMint
        ? resolveTokenSymbol({
            mint: transaction.swapFromMint,
            detailSymbol: tokenDetailsByMint[transaction.swapFromMint]?.token.symbol,
            holdingSymbol: swapFromHolding?.symbol,
          })
        : "?");
    const toSymbol =
      transaction.swapToSymbol ||
      (transaction.swapToMint
        ? resolveTokenSymbol({
            mint: transaction.swapToMint,
            detailSymbol: tokenDetailsByMint[transaction.swapToMint]?.token.symbol,
            holdingSymbol: swapToHolding?.symbol,
          })
        : "?");
    const swapToIcon = transaction.swapToMint
      ? resolveTokenIcon({
          mint: transaction.swapToMint,
          imageUrl: swapToHolding?.imageUrl,
          detailLogoUrl:
            tokenDetailsByMint[transaction.swapToMint]?.token.logoUrl,
        })
      : null;
    iconElement = swapToIcon ? (
      <RNImage
        source={{ uri: swapToIcon }}
        style={{ width: 48, height: 48, borderRadius: 24 }}
      />
    ) : (
      <View className="h-12 w-12 rounded-full" />
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
    const solHolding = tokenHoldings.find((h) => h.mint === NATIVE_SOL_MINT);
    const solIcon = resolveTokenIcon({
      mint: NATIVE_SOL_MINT,
      imageUrl: solHolding?.imageUrl,
      detailLogoUrl: tokenDetailsByMint[NATIVE_SOL_MINT]?.token.logoUrl,
    });
    iconElement = (
      <RNImage
        source={{ uri: solIcon }}
        style={{ width: 48, height: 48, borderRadius: 24 }}
      />
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
  function ActivitySheet(
    { transactions, tokenHoldings, tokenDetailsByMint, onTransactionPress },
    ref,
  ) {
    const insets = useSafeAreaInsets();
    const snapPoints = useMemo(() => ["70%", "100%"], []);

    const renderBackdrop = useCallback(
      (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.3}
        />
      ),
      [],
    );

    const renderItem = useCallback(
      ({ item }: { item: Transaction }) => (
        <TransactionRow
          transaction={item}
          tokenHoldings={tokenHoldings}
          tokenDetailsByMint={tokenDetailsByMint}
          onPress={() => onTransactionPress(item)}
        />
      ),
      [tokenHoldings, tokenDetailsByMint, onTransactionPress],
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
        topInset={insets.top}
        enableDynamicSizing={false}
        backdropComponent={renderBackdrop}
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
