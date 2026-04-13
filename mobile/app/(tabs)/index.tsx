import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { ArrowDown, ArrowLeftRight, ArrowUp, Globe, Shield } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { LogoHeader } from "@/components/LogoHeader";
import { ActionButton } from "@/components/wallet/ActionButton";
import { ActivityFeed } from "@/components/wallet/ActivityFeed";
import { ActivitySheet } from "@/components/wallet/ActivitySheet";
import { BalanceBackgroundPicker } from "@/components/wallet/BalanceBackgroundPicker";
import { BalanceCard } from "@/components/wallet/BalanceCard";
import { BannerCarousel } from "@/components/wallet/BannerCarousel";
import { ReceiveSheet } from "@/components/wallet/ReceiveSheet";
import { SendSheet } from "@/components/wallet/SendSheet";
import { ShieldSheet } from "@/components/wallet/ShieldSheet";
import { SwapSheet } from "@/components/wallet/SwapSheet";
import { TokensList } from "@/components/wallet/TokensList";
import { TokensSheet } from "@/components/wallet/TokensSheet";
import { TransactionDetailsSheet } from "@/components/wallet/TransactionDetailsSheet";
import { buildTokenDetailHref } from "@/features/token-details/routes";
import { buildBrowserHref } from "@/features/dapp-browser/routes";
import { useDisplayPreferences } from "@/hooks/wallet/useDisplayPreferences";
import { useKaminoEarnings } from "@/hooks/wallet/useKaminoEarnings";
import { useSolPrice } from "@/hooks/wallet/useSolPrice";
import { useTokenHoldings } from "@/hooks/wallet/useTokenHoldings";
import { useWalletBalance } from "@/hooks/wallet/useWalletBalance";
import { useWalletInit } from "@/hooks/wallet/useWalletInit";
import { useWalletTransactions } from "@/hooks/wallet/useWalletTransactions";
import { onSolanaEnvChange } from "@/lib/solana/rpc/connection";
import { clearHoldingsCache } from "@/lib/solana/token-holdings/fetch-token-holdings";
import {
  getCachedBalanceBg,
  resetWalletBalanceSubscription,
  setCachedBalanceBg,
} from "@/lib/solana/wallet-cache";
import { ScrollView, Text, View } from "@/tw";
import type { Transaction } from "@/types/wallet";

export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
  const { earnings: kaminoEarnings, refresh: refreshKaminoEarnings } =
    useKaminoEarnings();

  // Re-fetch everything when the Solana network is switched in Settings
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkKey, setNetworkKey] = useState(0);

  useEffect(() => {
    return onSolanaEnvChange(() => {
      clearHoldingsCache();
      setNetworkLoading(true);
      setNetworkKey((k) => k + 1);

      void resetWalletBalanceSubscription().then(() =>
        Promise.all([
          refreshBalance(true),
          refreshTokenHoldings(true),
          loadWalletTransactions({ force: true }),
        ]).finally(() => setNetworkLoading(false)),
      );
    });
  }, [refreshBalance, refreshTokenHoldings, loadWalletTransactions]);

  // Include shielded SOL in displayed balance
  const securedSolHolding = tokenHoldings.find(
    (h) => h.isSecured && h.mint === "So11111111111111111111111111111111111111112",
  );
  const securedSolLamports = securedSolHolding
    ? Math.floor(securedSolHolding.balance * 1e9)
    : 0;
  const totalSolLamports = (solBalanceLamports ?? 0) + securedSolLamports;
  const totalPortfolioUsd = useMemo(() => {
    let total = 0;
    let hasValuation = false;

    for (const holding of tokenHoldings) {
      if (typeof holding.valueUsd === "number" && Number.isFinite(holding.valueUsd)) {
        total += holding.valueUsd;
        hasValuation = true;
        continue;
      }
      if (
        typeof holding.priceUsd === "number" &&
        Number.isFinite(holding.priceUsd) &&
        holding.priceUsd > 0
      ) {
        total += holding.balance * holding.priceUsd;
        hasValuation = true;
      }
    }

    return hasValuation ? total : null;
  }, [tokenHoldings]);

  const [isSendOpen, setIsSendOpen] = useState(false);
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);
  const [isSwapOpen, setIsSwapOpen] = useState(false);
  const [isShieldOpen, setIsShieldOpen] = useState(false);
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

  const handleShieldComplete = useCallback(() => {
    refreshBalance(true);
    refreshTokenHoldings(true);
    loadWalletTransactions({ force: true });
    void refreshKaminoEarnings();
  }, [
    refreshBalance,
    refreshTokenHoldings,
    loadWalletTransactions,
    refreshKaminoEarnings,
  ]);

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

  const handleTokenPress = useCallback(
    (mint: string) => {
      router.push(buildTokenDetailHref(mint));
    },
    [router],
  );

  const handleShowAllActivity = useCallback(() => {
    activitySheetRef.current?.present();
  }, []);

  const handleOpenBrowser = useCallback(() => {
    router.push(buildBrowserHref() as never);
  }, [router]);

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
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 120, 132) }}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={handleRefresh} />
        }
      >
        <BalanceCard
          key={networkKey}
          walletAddress={walletAddress}
          solBalanceLamports={totalSolLamports}
          solPriceUsd={solPriceUsd}
          totalPortfolioUsd={totalPortfolioUsd}
          displayCurrency={displayCurrency}
          onToggleCurrency={handleToggleCurrency}
          isLoading={isLoading || networkLoading}
          walletError={walletError}
          onRetry={retryWalletInit}
          earnings={kaminoEarnings}
        />

        {/* Action buttons */}
        <View className="mt-6 flex-row flex-wrap justify-center gap-6 px-4">
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
          <ActionButton
            icon={<Shield size={28} color="#000" strokeWidth={1.5} />}
            label="Shield"
            onPress={() => setIsShieldOpen(true)}
          />
          <ActionButton
            icon={<Globe size={28} color="#000" strokeWidth={1.5} />}
            label="Browser"
            onPress={handleOpenBrowser}
          />
        </View>

        {/* Banner carousel */}
        <BannerCarousel />

        {/* Token holdings */}
        <View>
          <TokensList
            holdings={networkLoading ? [] : tokenHoldings}
            isLoading={isHoldingsLoading || networkLoading}
            onSeeAll={handleShowAllTokens}
            onTokenPress={handleTokenPress}
          />
        </View>

        {/* Activity feed */}
        <View>
          <ActivityFeed
            transactions={networkLoading ? [] : walletTransactions}
            tokenHoldings={networkLoading ? [] : tokenHoldings}
            isLoading={isFetchingTransactions || networkLoading}
            onTransactionPress={handleTransactionPress}
            onShowAll={handleShowAllActivity}
          />
        </View>
      </ScrollView>

      <SendSheet
        open={isSendOpen}
        onClose={() => setIsSendOpen(false)}
        solBalanceLamports={solBalanceLamports}
        solPriceUsd={solPriceUsd}
        tokenHoldings={tokenHoldings}
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
        onSwapComplete={handleSwapComplete}
      />

      <ShieldSheet
        open={isShieldOpen}
        onClose={() => setIsShieldOpen(false)}
        walletAddress={walletAddress}
        tokenHoldings={tokenHoldings}
        onShieldComplete={handleShieldComplete}
      />

      <BalanceBackgroundPicker
        open={isBgPickerOpen}
        onClose={() => setIsBgPickerOpen(false)}
        selectedBg={balanceBg}
        onSelect={handleBgSelect}
      />

      <TokensSheet
        ref={tokensSheetRef}
        holdings={tokenHoldings}
        onTokenPress={handleTokenPress}
      />

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
