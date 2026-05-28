import { BottomSheetModal } from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Shield,
  ShieldOff,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { ActivityIndicator, RefreshControl } from "react-native";
import {
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";
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
import { shouldShowWalletTopUp } from "@/components/wallet/wallet-screen-helpers";
import { buildTokenDetailHref } from "@/features/token-details/routes";
import { useDisplayPreferences } from "@/hooks/wallet/useDisplayPreferences";
import { useKaminoEarnings } from "@/hooks/wallet/useKaminoEarnings";
import { useSolPrice } from "@/hooks/wallet/useSolPrice";
import { useTokenApy } from "@/hooks/wallet/useTokenApy";
import { useTokenDetails } from "@/hooks/wallet/useTokenDetails";
import { useTokenHoldings } from "@/hooks/wallet/useTokenHoldings";
import {
  useWalletAutoRefresh,
  type WalletRefreshReason,
} from "@/hooks/wallet/useWalletAutoRefresh";
import { useWalletBalance } from "@/hooks/wallet/useWalletBalance";
import { useWalletInit } from "@/hooks/wallet/useWalletInit";
import { useWalletTransactions } from "@/hooks/wallet/useWalletTransactions";
import { track } from "@/lib/analytics/analytics";
import { PORTFOLIO_EVENTS } from "@/lib/analytics/portfolio-events";
import {
  LOYAL_TOKEN_MINT,
  NATIVE_SOL_MINT,
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDC_MINT_MAINNET,
} from "@/lib/solana/constants";
import { getSolanaEnv, onSolanaEnvChange } from "@/lib/solana/rpc/connection";
import { clearHoldingsCache } from "@/lib/solana/token-holdings/fetch-token-holdings";
import {
  getCachedBalanceBg,
  setCachedBalanceBg,
} from "@/lib/solana/wallet-cache";
import type { ShieldDirection } from "@/lib/solana/shielding";
import {
  DEFAULT_BALANCE_BACKGROUND_ID,
  findBalanceBackground,
} from "@/lib/wallet/balance-backgrounds";
import { AnimatedScrollView, ScrollView, Text, View } from "@/tw";
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
  const apyByMint = useTokenApy(tokenHoldings);
  const {
    walletTransactions,
    isFetchingTransactions,
    loadWalletTransactions,
  } = useWalletTransactions(walletAddress);
  const { earnings: kaminoEarnings, refresh: refreshKaminoEarnings } =
    useKaminoEarnings();

  const doFullRefresh = useCallback(
    async (reason: WalletRefreshReason) => {
      const forceOnChainState =
        reason === "manual" ||
        reason === "mutation" ||
        reason === "network-switch";

      await Promise.allSettled([
        refreshBalance(forceOnChainState),
        refreshTokenHoldings(forceOnChainState),
        loadWalletTransactions({ force: forceOnChainState }),
      ]);
    },
    [refreshBalance, refreshTokenHoldings, loadWalletTransactions],
  );

  const { requestRefresh } = useWalletAutoRefresh({
    walletAddress,
    refresh: doFullRefresh,
  });

  // Re-fetch everything when the Solana network is switched in Settings
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkKey, setNetworkKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [tokenMarketRefreshKey, setTokenMarketRefreshKey] = useState(0);

  // Shared cache of /api/mobile/tokens/:mint for every mint shown in the
  // tokens list or activity feed — used for logos and symbols so we never
  // render raw token-list SVGs or the "Token" symbol fallback.
  //
  // Always include the prefill mints (SOL/LOYAL/USDC) that TokensList shows
  // at zero balance on fresh wallets. Helius's `getAssetsByOwner` only
  // returns SOL + any SPL mints with an existing ATA, so zero-balance LOYAL
  // and USDC otherwise slip past the detail fetch and render without price,
  // change %, or (for USDC) the right logo.
  const tokenDetailMints = useMemo(() => {
    const mints = new Set<string>();
    mints.add(NATIVE_SOL_MINT);
    mints.add(LOYAL_TOKEN_MINT);
    mints.add(
      getSolanaEnv() === "mainnet"
        ? SOLANA_USDC_MINT_MAINNET
        : SOLANA_USDC_MINT_DEVNET,
    );
    for (const holding of tokenHoldings) mints.add(holding.mint);
    for (const tx of walletTransactions) {
      if (tx.tokenMint) mints.add(tx.tokenMint);
      if (tx.swapFromMint) mints.add(tx.swapFromMint);
      if (tx.swapToMint) mints.add(tx.swapToMint);
    }
    return Array.from(mints);
  }, [tokenHoldings, walletTransactions]);
  const tokenDetailsByMint = useTokenDetails(
    tokenDetailMints,
    tokenMarketRefreshKey,
  );

  useEffect(() => {
    return onSolanaEnvChange(() => {
      clearHoldingsCache();
      setNetworkLoading(true);
      setNetworkKey((k) => k + 1);
      setTokenMarketRefreshKey((k) => k + 1);

      Promise.resolve(requestRefresh("network-switch")).finally(() =>
        setNetworkLoading(false),
      );
    });
  }, [requestRefresh]);

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
  const [shieldDirection, setShieldDirection] =
    useState<ShieldDirection>("shield");
  const [isBgPickerOpen, setIsBgPickerOpen] = useState(false);
  const [balanceBg, setBalanceBg] = useState<string | null>(() => {
    const cached = getCachedBalanceBg();
    return cached !== undefined ? cached : DEFAULT_BALANCE_BACKGROUND_ID;
  });
  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);

  const tokensSheetRef = useRef<BottomSheetModal>(null);
  const activitySheetRef = useRef<BottomSheetModal>(null);
  const txDetailsSheetRef = useRef<BottomSheetModal>(null);

  const handleToggleCurrency = useCallback(() => {
    setDisplayCurrency((prev) => (prev === "USD" ? "SOL" : "USD"));
  }, [setDisplayCurrency]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setTokenMarketRefreshKey((k) => k + 1);

    // Wall-clock deadline so even a socket-level hang (fetch without
    // AbortController, stuck websocket) can't trap the spinner. Work
    // itself runs through the coordinator which de-dupes against any
    // ambient refresh already in flight.
    const REFRESH_DEADLINE_MS = 15_000;
    const work = requestRefresh("manual");
    const deadline = new Promise<"deadline">((resolve) =>
      setTimeout(() => resolve("deadline"), REFRESH_DEADLINE_MS),
    );

    try {
      const outcome = await Promise.race([
        Promise.resolve(work).then(() => "done" as const),
        deadline,
      ]);
      if (outcome === "deadline") {
        console.warn(
          "[wallet-refresh] deadline hit; some requests still pending",
        );
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [requestRefresh]);

  const handleSendComplete = useCallback(() => {
    void requestRefresh("mutation");
  }, [requestRefresh]);

  const handleSwapComplete = useCallback(() => {
    void requestRefresh("mutation");
  }, [requestRefresh]);

  const handleShieldComplete = useCallback(() => {
    void requestRefresh("mutation");
    void refreshKaminoEarnings();
  }, [requestRefresh, refreshKaminoEarnings]);

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
      if (process.env.EXPO_OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      router.push(buildTokenDetailHref(mint));
    },
    [router],
  );

  const handleShowAllActivity = useCallback(() => {
    activitySheetRef.current?.present();
  }, []);

  const handleOpenShield = useCallback((direction: ShieldDirection) => {
    setShieldDirection(direction);
    setIsShieldOpen(true);
  }, []);

  const handleBgSelect = useCallback((bg: string | null) => {
    setBalanceBg(bg);
    setCachedBalanceBg(bg);
  }, []);

  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const morphColors = useMemo(() => {
    const opt = findBalanceBackground(balanceBg ?? null);
    return {
      bg: opt?.dominantColor ?? "#1c1c1e",
      text: opt?.dominantTextColor ?? "#ffffff",
    };
  }, [balanceBg]);

  const morphText = useMemo(() => {
    if (typeof totalPortfolioUsd !== "number") return null;
    return `$${totalPortfolioUsd.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }, [totalPortfolioUsd]);

  const showTopUpAction = useMemo(
    () =>
      shouldShowWalletTopUp({
        totalSolLamports,
        holdings: tokenHoldings,
        isLoading,
        networkLoading,
        walletError,
      }),
    [totalSolLamports, tokenHoldings, isLoading, networkLoading, walletError],
  );

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
      <LogoHeader
        scrollY={scrollY}
        morphText={morphText}
        morphColor={morphColors.bg}
        morphTextColor={morphColors.text}
      />
      <AnimatedScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + 120, 132) }}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
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
          showTopUpAction={showTopUpAction}
          onTopUpPress={() => setIsReceiveOpen(true)}
          balanceBg={balanceBg}
          onOpenBgPicker={() => setIsBgPickerOpen(true)}
        />

        {/* Action buttons */}
        <View className="mt-6 flex-row flex-wrap justify-center gap-6 px-4">
          <ActionButton
            icon={<ArrowUp size={28} color="#000" strokeWidth={1.5} />}
            label="Send"
            onPress={() => {
              track(PORTFOLIO_EVENTS.openSend);
              setIsSendOpen(true);
            }}
          />
          <ActionButton
            icon={<ArrowDown size={28} color="#000" strokeWidth={1.5} />}
            label="Receive"
            onPress={() => {
              track(PORTFOLIO_EVENTS.openReceive);
              setIsReceiveOpen(true);
            }}
          />
          <ActionButton
            icon={<ArrowLeftRight size={28} color="#000" strokeWidth={1.5} />}
            label="Swap"
            onPress={() => {
              track(PORTFOLIO_EVENTS.openSwap);
              setIsSwapOpen(true);
            }}
          />
          <ActionButton
            icon={<Shield size={28} color="#000" strokeWidth={1.5} />}
            label="Shield"
            onPress={() => {
              track(PORTFOLIO_EVENTS.openShield);
              handleOpenShield("shield");
            }}
          />
          <ActionButton
            icon={<ShieldOff size={28} color="#000" strokeWidth={1.5} />}
            label="Unshield"
            onPress={() => {
              track(PORTFOLIO_EVENTS.openUnshield);
              handleOpenShield("unshield");
            }}
          />
        </View>

        {/* Banner carousel */}
        <View style={{ marginTop: 24 }}>
          <BannerCarousel
            onShield={() => {
              track(PORTFOLIO_EVENTS.openShield, { source: "banner" });
              handleOpenShield("shield");
            }}
          />
        </View>

        {/* Token holdings */}
        <View style={{ marginTop: 16 }}>
          <TokensList
            holdings={networkLoading ? [] : tokenHoldings}
            apyByMint={apyByMint}
            tokenDetailsByMint={tokenDetailsByMint}
            isLoading={isHoldingsLoading || networkLoading}
            onSeeAll={handleShowAllTokens}
            onTokenPress={handleTokenPress}
          />
        </View>

        {/* Activity feed */}
        <View style={{ marginTop: 16 }}>
          <ActivityFeed
            transactions={networkLoading ? [] : walletTransactions}
            tokenHoldings={networkLoading ? [] : tokenHoldings}
            tokenDetailsByMint={tokenDetailsByMint}
            isLoading={isFetchingTransactions || networkLoading}
            onTransactionPress={handleTransactionPress}
            onShowAll={handleShowAllActivity}
          />
        </View>
      </AnimatedScrollView>

      <SendSheet
        open={isSendOpen}
        onClose={() => setIsSendOpen(false)}
        solBalanceLamports={solBalanceLamports}
        solPriceUsd={solPriceUsd}
        tokenHoldings={tokenHoldings}
        tokenDetailsByMint={tokenDetailsByMint}
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
        tokenDetailsByMint={tokenDetailsByMint}
        onSwapComplete={handleSwapComplete}
      />

      <ShieldSheet
        open={isShieldOpen}
        onClose={() => setIsShieldOpen(false)}
        walletAddress={walletAddress}
        tokenHoldings={tokenHoldings}
        tokenDetailsByMint={tokenDetailsByMint}
        onShieldComplete={handleShieldComplete}
        initialDirection={shieldDirection}
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
        apyByMint={apyByMint}
        tokenDetailsByMint={tokenDetailsByMint}
        onTokenPress={handleTokenPress}
      />

      <ActivitySheet
        ref={activitySheetRef}
        transactions={walletTransactions}
        tokenHoldings={tokenHoldings}
        tokenDetailsByMint={tokenDetailsByMint}
        onTransactionPress={handleTransactionPress}
      />

      <TransactionDetailsSheet
        ref={txDetailsSheetRef}
        transaction={selectedTransaction}
        tokenHoldings={tokenHoldings}
        tokenDetailsByMint={tokenDetailsByMint}
      />
    </View>
  );
}
