import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { ExternalLink } from "lucide-react-native";
import { forwardRef, useCallback, useMemo } from "react";
import { Linking } from "react-native";

import type { TokenDetailsByMint } from "@/hooks/wallet/useTokenDetails";
import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import { resolveTokenSymbol } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
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
  tokenHoldings: TokenHolding[];
  tokenDetailsByMint: TokenDetailsByMint;
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-3">
      <Text
        className="text-[15px]"
        style={{ color: "rgba(60, 60, 67, 0.6)" }}
      >
        {label}
      </Text>
      <Text
        className="text-[15px] font-medium text-black"
        numberOfLines={1}
        style={{ maxWidth: "60%", textAlign: "right" }}
      >
        {value}
      </Text>
    </View>
  );
}

export const TransactionDetailsSheet = forwardRef<
  BottomSheetModal,
  TransactionDetailsSheetProps
>(function TransactionDetailsSheet(
  { transaction, tokenHoldings, tokenDetailsByMint },
  ref,
) {
  const explorerUrl = useMemo(() => {
    if (!transaction?.signature) return null;
    const env = getSolanaEnv();
    const cluster = env === "mainnet" ? "" : `?cluster=${env}`;
    return `https://solscan.io/tx/${transaction.signature}${cluster}`;
  }, [transaction?.signature]);

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

  const amountDisplay = (() => {
    if (transaction.tokenAmount && transaction.tokenMint) {
      const holding = tokenHoldings.find(
        (h) => h.mint === transaction.tokenMint,
      );
      const detail = tokenDetailsByMint[transaction.tokenMint];
      const symbol = resolveTokenSymbol({
        mint: transaction.tokenMint,
        detailSymbol: detail?.token.symbol,
        holdingSymbol: holding?.symbol,
      });
      return `${transaction.tokenAmount} ${symbol}`;
    }
    return `${formatTransactionAmount(transaction.amountLamports)} SOL`;
  })();

  const statusText = getStatusText(
    transaction.status ?? "completed",
    isIncoming,
  );

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={{ backgroundColor: "rgba(0,0,0,0.15)", width: 36 }}
      backgroundStyle={{ borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
    >
      <BottomSheetView>
        <View className="px-6 pb-10 pt-2">
          {/* Header */}
          <View className="items-center pb-5">
            <Text
              className="text-[17px] font-semibold text-black"
              style={{ lineHeight: 22 }}
            >
              {title}
            </Text>
            <Text
              className="mt-2 text-[32px] font-bold"
              style={{
                color: isIncoming ? "#32e55e" : "#000",
                letterSpacing: -0.5,
              }}
            >
              {isIncoming ? "+" : transaction.type === "outgoing" ? "\u2212" : ""}
              {amountDisplay}
            </Text>
          </View>

          {/* Details card */}
          <View
            className="rounded-2xl px-4"
            style={{ backgroundColor: "rgba(0, 0, 0, 0.03)" }}
          >
            <DetailRow label="Status" value={statusText} />
            <DetailRow
              label="Date"
              value={formatTransactionDate(transaction.timestamp)}
            />
            {transaction.sender ? (
              <DetailRow
                label="From"
                value={
                  transaction.sender.startsWith("@")
                    ? transaction.sender
                    : formatAddress(transaction.sender)
                }
              />
            ) : null}
            {transaction.recipient ? (
              <DetailRow
                label="To"
                value={
                  transaction.recipient.startsWith("@")
                    ? transaction.recipient
                    : formatAddress(transaction.recipient)
                }
              />
            ) : null}
            {transaction.networkFeeLamports != null &&
            transaction.networkFeeLamports > 0 ? (
              <DetailRow
                label="Network Fee"
                value={`${formatTransactionAmount(transaction.networkFeeLamports)} SOL`}
              />
            ) : null}
            {isSwap && transaction.swapFromMint ? (
              <>
                {transaction.swapFromSymbol ? (
                  <DetailRow
                    label="From Token"
                    value={transaction.swapFromSymbol}
                  />
                ) : null}
                {transaction.swapToSymbol ? (
                  <DetailRow
                    label="To Token"
                    value={transaction.swapToSymbol}
                  />
                ) : null}
                {transaction.swapToAmount != null ? (
                  <DetailRow
                    label="Received"
                    value={`${transaction.swapToAmount.toLocaleString("en-US", {
                      maximumFractionDigits: 6,
                    })}`}
                  />
                ) : null}
              </>
            ) : null}
          </View>

          {/* Explorer link */}
          {explorerUrl ? (
            <Pressable
              onPress={() => Linking.openURL(explorerUrl)}
              className="mt-5 flex-row items-center justify-center gap-2 rounded-2xl py-4"
              style={{ backgroundColor: "#f9363c" }}
            >
              <ExternalLink size={18} color="#fff" strokeWidth={2} />
              <Text className="text-[16px] font-semibold text-white">
                View on Solscan
              </Text>
            </Pressable>
          ) : null}
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
});
