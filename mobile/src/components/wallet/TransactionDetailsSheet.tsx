import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import { ExternalLink } from "lucide-react-native";
import { forwardRef, useMemo } from "react";
import { Linking } from "react-native";

import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import {
  formatAddress,
  formatTransactionAmount,
  formatTransactionDate,
  getStatusText,
} from "@/lib/solana/wallet/formatters";
import { Pressable, Text, View } from "@/tw";
import type { Transaction } from "@/types/wallet";

type TransactionDetailsSheetProps = {
  transaction: Transaction | null;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-2.5">
      <Text className="text-sm text-neutral-500">{label}</Text>
      <Text className="text-sm font-medium text-black">{value}</Text>
    </View>
  );
}

export const TransactionDetailsSheet = forwardRef<
  BottomSheetModal,
  TransactionDetailsSheetProps
>(function TransactionDetailsSheet({ transaction }, ref) {
  const explorerUrl = useMemo(() => {
    if (!transaction?.signature) return null;
    const env = getSolanaEnv();
    const cluster = env === "mainnet" ? "" : `?cluster=${env}`;
    return `https://solscan.io/tx/${transaction.signature}${cluster}`;
  }, [transaction?.signature]);

  if (!transaction) return null;

  const isIncoming = transaction.type === "incoming";
  const isSwap = transaction.transferType === "swap";
  const isSecure = transaction.transferType === "secure";
  const isUnshield = transaction.transferType === "unshield";

  let title: string;
  if (isSwap) {
    title = "Swap";
  } else if (isSecure) {
    title = "Shielded";
  } else if (isUnshield) {
    title = "Unshielded";
  } else if (transaction.transferType === "store") {
    title = "Store Data";
  } else if (transaction.transferType === "verify_telegram_init_data") {
    title = "Verify Data";
  } else {
    title = isIncoming ? "Received" : "Sent";
  }

  const amountDisplay =
    transaction.tokenAmount && transaction.tokenMint
      ? `${transaction.tokenAmount} Token`
      : `${formatTransactionAmount(transaction.amountLamports)} SOL`;

  const statusText = getStatusText(
    transaction.status ?? "completed",
    isIncoming,
  );
  return (
    <BottomSheetModal ref={ref} enableDynamicSizing>
      <BottomSheetView className="px-4 pb-10">
        {/* Header */}
        <View className="items-center pb-4">
          <Text className="text-lg font-semibold text-black">{title}</Text>
          <Text
            className="mt-1 text-2xl font-bold"
            style={{ color: isIncoming ? "#32e55e" : "#000" }}
          >
            {isIncoming ? "+" : transaction.type === "outgoing" ? "\u2212" : ""}
            {amountDisplay}
          </Text>
        </View>

        {/* Divider */}
        <View className="h-px bg-neutral-200" />

        {/* Details */}
        <View className="py-2">
          <DetailRow label="Status" value={statusText} />
          <DetailRow
            label="Date"
            value={formatTransactionDate(transaction.timestamp)}
          />
          {transaction.sender && (
            <DetailRow
              label="From"
              value={
                transaction.sender.startsWith("@")
                  ? transaction.sender
                  : formatAddress(transaction.sender)
              }
            />
          )}
          {transaction.recipient && (
            <DetailRow
              label="To"
              value={
                transaction.recipient.startsWith("@")
                  ? transaction.recipient
                  : formatAddress(transaction.recipient)
              }
            />
          )}
          {transaction.networkFeeLamports != null &&
            transaction.networkFeeLamports > 0 && (
              <DetailRow
                label="Network Fee"
                value={`${formatTransactionAmount(transaction.networkFeeLamports)} SOL`}
              />
            )}
          {isSwap && transaction.swapFromMint && (
            <>
              {transaction.swapFromSymbol && (
                <DetailRow label="From Token" value={transaction.swapFromSymbol} />
              )}
              {transaction.swapToSymbol && (
                <DetailRow label="To Token" value={transaction.swapToSymbol} />
              )}
              {transaction.swapToAmount != null && (
                <DetailRow
                  label="Received"
                  value={`${transaction.swapToAmount.toLocaleString("en-US", { maximumFractionDigits: 6 })}`}
                />
              )}
            </>
          )}
        </View>

        {/* Explorer link */}
        {explorerUrl && (
          <>
            <View className="h-px bg-neutral-200" />
            <Pressable
              onPress={() => Linking.openURL(explorerUrl)}
              className="mt-3 flex-row items-center justify-center gap-2 rounded-xl bg-neutral-100 py-3"
            >
              <ExternalLink size={16} color="#6b7280" />
              <Text className="text-sm font-medium text-neutral-600">
                View on Solscan
              </Text>
            </Pressable>
          </>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
});
