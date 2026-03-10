import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { ArrowDown, ArrowLeftRight, ArrowUp } from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ActionButton } from "@/components/wallet/ActionButton";
import { ActivityFeed } from "@/components/wallet/ActivityFeed";
import { ActivitySheet } from "@/components/wallet/ActivitySheet";
import { BalanceCard } from "@/components/wallet/BalanceCard";
import { ReceiveSheet } from "@/components/wallet/ReceiveSheet";
import { SendSheet } from "@/components/wallet/SendSheet";
import { TokensList } from "@/components/wallet/TokensList";
import { TokensSheet } from "@/components/wallet/TokensSheet";
import { TransactionDetailsSheet } from "@/components/wallet/TransactionDetailsSheet";
import { useDisplayPreferences } from "@/hooks/wallet/useDisplayPreferences";
import { useSolPrice } from "@/hooks/wallet/useSolPrice";
import { useTokenHoldings } from "@/hooks/wallet/useTokenHoldings";
import { useWalletBalance } from "@/hooks/wallet/useWalletBalance";
import { useWalletInit } from "@/hooks/wallet/useWalletInit";
import { useWalletTransactions } from "@/hooks/wallet/useWalletTransactions";
import { ScrollView, Text, View } from "@/tw";
import type { Transaction } from "@/types/wallet";

export default function WalletScreen() {
  const { walletAddress, isLoading, walletError, retryWalletInit } =
    useWalletInit();
  const { solBalanceLamports, refreshBalance } =
    useWalletBalance(walletAddress);
  const { solPriceUsd } = useSolPrice();
  const { displayCurrency, setDisplayCurrency } = useDisplayPreferences();
  const { tokenHoldings, isHoldingsLoading, refreshTokenHoldings } =
    useTokenHoldings(walletAddress);
  const {
    walletTransactions,
    isFetchingTransactions,
    loadWalletTransactions,
  } = useWalletTransactions(walletAddress);

  const [isSendOpen, setIsSendOpen] = useState(false);
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);

  const tokensSheetRef = useRef<BottomSheetModal>(null);
  const activitySheetRef = useRef<BottomSheetModal>(null);
  const txDetailsSheetRef = useRef<BottomSheetModal>(null);

  const handleToggleCurrency = useCallback(() => {
    setDisplayCurrency((prev) => (prev === "USD" ? "SOL" : "USD"));
  }, [setDisplayCurrency]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      refreshBalance(true),
      refreshTokenHoldings(true),
      loadWalletTransactions({ force: true }),
    ]);
  }, [refreshBalance, refreshTokenHoldings, loadWalletTransactions]);

  const handleSendComplete = useCallback(() => {
    refreshBalance(true);
    loadWalletTransactions({ force: true });
  }, [refreshBalance, loadWalletTransactions]);

  const handleTransactionPress = useCallback(
    (transaction: Transaction) => {
      setSelectedTransaction(transaction);
      txDetailsSheetRef.current?.present();
    },
    [],
  );

  const handleShowAllTokens = useCallback(() => {
    tokensSheetRef.current?.present();
  }, []);

  const handleShowAllActivity = useCallback(() => {
    activitySheetRef.current?.present();
  }, []);

  if (isLoading && !walletAddress) {
    return (
      <SafeAreaView
        edges={["top"]}
        className="flex-1 items-center justify-center bg-white"
      >
        <ActivityIndicator size="large" color="#000" />
        <Text className="mt-3 text-sm text-neutral-500">
          Loading wallet...
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-8"
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={handleRefresh} />
        }
      >
        <BalanceCard
          walletAddress={walletAddress}
          solBalanceLamports={solBalanceLamports}
          solPriceUsd={solPriceUsd}
          displayCurrency={displayCurrency}
          onToggleCurrency={handleToggleCurrency}
          isLoading={isLoading}
          walletError={walletError}
          onRetry={retryWalletInit}
        />

        {/* Action buttons */}
        <View className="mt-6 flex-row justify-center gap-8 px-4">
          <ActionButton
            icon={<ArrowUp size={22} color="white" strokeWidth={2} />}
            label="Send"
            onPress={() => setIsSendOpen(true)}
          />
          <ActionButton
            icon={<ArrowDown size={22} color="white" strokeWidth={2} />}
            label="Receive"
            onPress={() => setIsReceiveOpen(true)}
          />
          <ActionButton
            icon={<ArrowLeftRight size={22} color="white" strokeWidth={2} />}
            label="Swap"
            onPress={() => {}}
          />
        </View>

        {/* Token holdings */}
        <View className="mt-8">
          <TokensList
            holdings={tokenHoldings}
            isLoading={isHoldingsLoading}
            onSeeAll={handleShowAllTokens}
          />
        </View>

        {/* Activity feed */}
        <View className="mt-6">
          <ActivityFeed
            transactions={walletTransactions}
            tokenHoldings={tokenHoldings}
            isLoading={isFetchingTransactions}
            onTransactionPress={handleTransactionPress}
            onShowAll={handleShowAllActivity}
          />
        </View>
      </ScrollView>

      <SendSheet
        open={isSendOpen}
        onClose={() => setIsSendOpen(false)}
        walletAddress={walletAddress}
        solBalanceLamports={solBalanceLamports}
        solPriceUsd={solPriceUsd}
        onSendComplete={handleSendComplete}
      />

      <ReceiveSheet
        open={isReceiveOpen}
        onClose={() => setIsReceiveOpen(false)}
        walletAddress={walletAddress}
      />

      <TokensSheet ref={tokensSheetRef} holdings={tokenHoldings} />

      <ActivitySheet
        ref={activitySheetRef}
        transactions={walletTransactions}
        tokenHoldings={tokenHoldings}
        onTransactionPress={handleTransactionPress}
      />

      <TransactionDetailsSheet
        ref={txDetailsSheetRef}
        transaction={selectedTransaction}
      />
    </SafeAreaView>
  );
}
