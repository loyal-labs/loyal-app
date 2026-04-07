import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { ArrowDown, ArrowLeftRight, ArrowUp } from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl } from "react-native";

import { LogoHeader } from "@/components/LogoHeader";
import { ActionButton } from "@/components/wallet/ActionButton";
import { ActivityFeed } from "@/components/wallet/ActivityFeed";
import { ActivitySheet } from "@/components/wallet/ActivitySheet";
import { BalanceBackgroundPicker } from "@/components/wallet/BalanceBackgroundPicker";
import { BalanceCard } from "@/components/wallet/BalanceCard";
import { BannerCarousel } from "@/components/wallet/BannerCarousel";
import { LockScreen } from "@/components/wallet/LockScreen";
import { OnboardingGate } from "@/components/wallet/OnboardingGate";
import { ReceiveSheet } from "@/components/wallet/ReceiveSheet";
import { SendSheet } from "@/components/wallet/SendSheet";
import { SwapSheet } from "@/components/wallet/SwapSheet";
import { TokensList } from "@/components/wallet/TokensList";
import { TokensSheet } from "@/components/wallet/TokensSheet";
import { TransactionDetailsSheet } from "@/components/wallet/TransactionDetailsSheet";
import { useDisplayPreferences } from "@/hooks/wallet/useDisplayPreferences";
import { useSolPrice } from "@/hooks/wallet/useSolPrice";
import { useTokenHoldings } from "@/hooks/wallet/useTokenHoldings";
import { useWalletBalance } from "@/hooks/wallet/useWalletBalance";
import { useWalletInit } from "@/hooks/wallet/useWalletInit";
import { useWalletTransactions } from "@/hooks/wallet/useWalletTransactions";
import {
  getCachedBalanceBg,
  setCachedBalanceBg,
} from "@/lib/solana/wallet-cache";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { ScrollView, Text, View } from "@/tw";
import type { Transaction } from "@/types/wallet";

export default function WalletScreen() {
  const { state } = useWallet();

  if (state === "loading") {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#000" />
      </View>
    );
  }

  if (state === "noWallet") {
    return <OnboardingGate />;
  }

  if (state === "locked") {
    return <LockScreen />;
  }

  // state === "unlocked" — show actual wallet content
  return <WalletContent />;
}

function WalletContent() {
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
  const [isSwapOpen, setIsSwapOpen] = useState(false);
  const [isBgPickerOpen, setIsBgPickerOpen] = useState(false);
  const [balanceBg, setBalanceBg] = useState<string | null>(
    () => getCachedBalanceBg() ?? null,
  );
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

  const handleSwapComplete = useCallback(() => {
    refreshBalance(true);
    refreshTokenHoldings(true);
    loadWalletTransactions({ force: true });
  }, [refreshBalance, refreshTokenHoldings, loadWalletTransactions]);

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

  const handleBgSelect = useCallback((bg: string | null) => {
    setBalanceBg(bg);
    setCachedBalanceBg(bg);
  }, []);

  if (isLoading && !walletAddress) {
    return (
      <ScrollView
        className="flex-1 bg-white"
        contentInsetAdjustmentBehavior="automatic"
      >
        <LogoHeader />
        <View className="flex-1 items-center justify-center py-20">
          <ActivityIndicator size="large" color="#000" />
          <Text
            className="mt-3 text-[15px]"
            style={{ color: "rgba(60, 60, 67, 0.6)" }}
          >
            Loading wallet...
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <LogoHeader />
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
            icon={<ArrowUp size={28} color="#000" strokeWidth={1.5} />}
            label="Send"
            onPress={() => setIsSendOpen(true)}
          />
          <ActionButton
            icon={<ArrowDown size={28} color="#000" strokeWidth={1.5} />}
            label="Receive"
            onPress={() => setIsReceiveOpen(true)}
          />
          <ActionButton
            icon={<ArrowLeftRight size={28} color="#000" strokeWidth={1.5} />}
            label="Swap"
            onPress={() => setIsSwapOpen(true)}
          />
        </View>

        {/* Banner carousel */}
        <BannerCarousel />

        {/* Token holdings */}
        <View>
          <TokensList
            holdings={tokenHoldings}
            isLoading={isHoldingsLoading}
            onSeeAll={handleShowAllTokens}
          />
        </View>

        {/* Activity feed */}
        <View>
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

      <SwapSheet
        open={isSwapOpen}
        onClose={() => setIsSwapOpen(false)}
        walletAddress={walletAddress}
        tokenHoldings={tokenHoldings}
        solPriceUsd={solPriceUsd}
        onSwapComplete={handleSwapComplete}
      />

      <BalanceBackgroundPicker
        open={isBgPickerOpen}
        onClose={() => setIsBgPickerOpen(false)}
        selectedBg={balanceBg}
        onSelect={handleBgSelect}
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
    </View>
  );
}
