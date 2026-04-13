import { BottomSheetModal } from "@gorhom/bottom-sheet";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  Copy,
  ExternalLink,
  RefreshCw,
  Share2,
  Shield,
} from "lucide-react-native";
import { type ReactNode, useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Share,
  useWindowDimensions,
} from "react-native";
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  Path,
  Stop,
} from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActivityFeed } from "@/components/wallet/ActivityFeed";
import { ReceiveSheet } from "@/components/wallet/ReceiveSheet";
import { SendSheet } from "@/components/wallet/SendSheet";
import { ShieldSheet } from "@/components/wallet/ShieldSheet";
import { SwapSheet } from "@/components/wallet/SwapSheet";
import { TransactionDetailsSheet } from "@/components/wallet/TransactionDetailsSheet";
import { useSolPrice } from "@/hooks/wallet/useSolPrice";
import { useTokenHoldings } from "@/hooks/wallet/useTokenHoldings";
import { useWalletBalance } from "@/hooks/wallet/useWalletBalance";
import { useWalletInit } from "@/hooks/wallet/useWalletInit";
import { useWalletTransactions } from "@/hooks/wallet/useWalletTransactions";
import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { ScrollView, Pressable, Text, View } from "@/tw";
import type { Transaction } from "@/types/wallet";

import { useTokenDetail } from "../useTokenDetail";

const SECTION_CARD_STYLE = { backgroundColor: "#f6f6f2" };
const CORAL = "#f97362";
const GREEN = "#32e55e";
const MUTED_TEXT = "rgba(60, 60, 67, 0.6)";

function formatCurrency(value: number | null, options?: Intl.NumberFormatOptions) {
  if (value === null || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
    ...options,
  }).format(value);
}

function formatCompactUsd(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatBalance(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  if (value >= 1000) {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (value >= 1) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  if (value > 0) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
  }
  return "0";
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "Unavailable";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatMint(mint: string) {
  if (mint.length <= 12) {
    return mint;
  }
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

function buildExplorerUrl(mint: string) {
  const env = getSolanaEnv();
  const cluster = env === "mainnet" ? "" : `?cluster=${env}`;
  return `https://solscan.io/token/${mint}${cluster}`;
}

function resolveSpotPrice(mint: string, holdings: TokenHolding[], remotePrice: number | null) {
  if (remotePrice !== null) {
    return remotePrice;
  }

  const localHolding = holdings.find(
    (holding) =>
      holding.mint === mint &&
      typeof holding.priceUsd === "number" &&
      Number.isFinite(holding.priceUsd),
  );

  return localHolding?.priceUsd ?? null;
}

function buildChartPath(
  points: { timestamp: number; priceUsd: number }[],
  width: number,
  height: number,
) {
  if (points.length === 0) {
    return "";
  }

  const prices = points.map((point) => point.priceUsd);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  return points
    .map((point, index) => {
      const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
      const y = height - ((point.priceUsd - min) / range) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function TokenLineChart({
  loading,
  points,
}: {
  loading: boolean;
  points: { timestamp: number; priceUsd: number }[];
}) {
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(width - 72, 120);
  const chartHeight = 120;

  if (loading && points.length === 0) {
    return (
      <View
        className="mt-5 h-[120px] items-center justify-center rounded-[24px]"
        style={{ backgroundColor: "#efefea" }}
      >
        <ActivityIndicator color={CORAL} />
        <Text className="mt-2 text-[13px]" style={{ color: MUTED_TEXT }}>
          Loading 24H chart
        </Text>
      </View>
    );
  }

  if (points.length === 0) {
    return (
      <View
        className="mt-5 h-[120px] items-center justify-center rounded-[24px]"
        style={{ backgroundColor: "#efefea" }}
      >
        <Text className="text-[13px]" style={{ color: MUTED_TEXT }}>
          Chart unavailable
        </Text>
      </View>
    );
  }

  const lineColor = points[points.length - 1].priceUsd >= points[0].priceUsd ? GREEN : CORAL;
  const path = buildChartPath(points, chartWidth, chartHeight - 12);

  return (
    <View
      className="mt-5 overflow-hidden rounded-[24px] px-3 py-3"
      style={{ backgroundColor: "#efefea" }}
    >
      <Svg width={chartWidth} height={chartHeight}>
        <Defs>
          <SvgLinearGradient id="token-chart-fill" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor={lineColor} stopOpacity="0.18" />
            <Stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </SvgLinearGradient>
        </Defs>
        <Path
          d={`${path} L ${chartWidth.toFixed(2)} ${chartHeight} L 0 ${chartHeight} Z`}
          fill="url(#token-chart-fill)"
        />
        <Path
          d={path}
          fill="none"
          stroke={lineColor}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <View className="rounded-[28px] p-5" style={SECTION_CARD_STYLE}>
      <View className="mb-4">
        <Text className="text-[18px] font-semibold text-black">{title}</Text>
        {subtitle ? (
          <Text className="mt-1 text-[13px]" style={{ color: MUTED_TEXT }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function ActionRailButton({
  label,
  icon,
  onPress,
  disabled = false,
  muted = false,
}: {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  muted?: boolean;
}) {
  return (
    <Pressable
      className="items-center gap-2"
      onPress={disabled ? undefined : onPress}
      style={{ opacity: disabled || muted ? 0.45 : 1 }}
    >
      <View
        className="h-[52px] w-[52px] items-center justify-center rounded-full"
        style={{ backgroundColor: "rgba(249, 54, 60, 0.14)" }}
      >
        {icon}
      </View>
      <Text className="text-[13px]" style={{ color: MUTED_TEXT }}>
        {label}
      </Text>
    </Pressable>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-2.5">
      <Text className="text-[14px]" style={{ color: MUTED_TEXT }}>
        {label}
      </Text>
      <Text className="text-[14px] font-medium text-black">{value}</Text>
    </View>
  );
}

function LinkRow({ label, url }: { label: string; url: string | null }) {
  if (!url) {
    return (
      <StatRow
        label={label}
        value="Unavailable"
      />
    );
  }

  return (
    <Pressable
      className="flex-row items-center justify-between py-2.5"
      onPress={() => Linking.openURL(url)}
    >
      <Text className="text-[14px]" style={{ color: MUTED_TEXT }}>
        {label}
      </Text>
      <View className="flex-row items-center gap-2">
        <Text className="max-w-[180px] text-[14px] font-medium text-black" numberOfLines={1}>
          {url.replace(/^https?:\/\//, "")}
        </Text>
        <ExternalLink size={16} color="#111111" />
      </View>
    </Pressable>
  );
}

export default function TokenDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { mint } = useLocalSearchParams<{ mint: string }>();
  const tokenMint = Array.isArray(mint) ? mint[0] : mint;

  const txDetailsSheetRef = useRef<BottomSheetModal>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [isSendOpen, setIsSendOpen] = useState(false);
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);
  const [isSwapOpen, setIsSwapOpen] = useState(false);
  const [isShieldOpen, setIsShieldOpen] = useState(false);

  const { walletAddress } = useWalletInit();
  const { solBalanceLamports, refreshBalance } = useWalletBalance(walletAddress);
  const { solPriceUsd } = useSolPrice();
  const { tokenHoldings, refreshTokenHoldings } = useTokenHoldings(walletAddress);
  const { walletTransactions, loadWalletTransactions, isFetchingTransactions } =
    useWalletTransactions(walletAddress);

  const {
    viewModel,
    loading,
    error,
    reload,
  } = useTokenDetail({
    mint: tokenMint ?? "",
    holdings: tokenHoldings,
    transactions: walletTransactions,
  });

  const handleTransactionPress = useCallback((transaction: Transaction) => {
    setSelectedTransaction(transaction);
    txDetailsSheetRef.current?.present();
  }, []);

  const handleRefreshWalletData = useCallback(async () => {
    await Promise.all([
      refreshBalance(true),
      refreshTokenHoldings(true),
      loadWalletTransactions({ force: true }),
      reload(),
    ]);
  }, [loadWalletTransactions, refreshBalance, refreshTokenHoldings, reload]);

  const handleSendComplete = useCallback(() => {
    void handleRefreshWalletData();
  }, [handleRefreshWalletData]);

  const handleSwapComplete = useCallback(() => {
    void handleRefreshWalletData();
  }, [handleRefreshWalletData]);

  const handleShieldComplete = useCallback(() => {
    void handleRefreshWalletData();
  }, [handleRefreshWalletData]);

  const handleCopyMint = useCallback(async () => {
    if (!tokenMint) return;
    await Clipboard.setStringAsync(tokenMint);
    if (process.env.EXPO_OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [tokenMint]);

  const handleShareMint = useCallback(async () => {
    if (!tokenMint) return;
    await Share.share({
      message: tokenMint,
      title: viewModel.token.symbol,
    });
  }, [tokenMint, viewModel.token.symbol]);

  const localHasData =
    viewModel.position.totalBalance > 0 || viewModel.activity.length > 0;
  const marketHasData =
    viewModel.market !== null || viewModel.chart.length > 0 || viewModel.links !== null;
  const showUnavailable = !loading && !localHasData && !marketHasData;
  const showEmptyPosition = viewModel.position.totalBalance === 0;

  const spotPrice = resolveSpotPrice(
    tokenMint ?? "",
    tokenHoldings,
    viewModel.market?.priceUsd ?? null,
  );
  const explorerUrl = tokenMint ? buildExplorerUrl(tokenMint) : null;
  const marketRows = [
    {
      label: "Market Cap",
      value:
        viewModel.market?.marketCapUsd != null
          ? formatCompactUsd(viewModel.market.marketCapUsd)
          : null,
    },
    {
      label: "Liquidity",
      value:
        viewModel.market?.liquidityUsd != null
          ? formatCompactUsd(viewModel.market.liquidityUsd)
          : null,
    },
    {
      label: "24H Volume",
      value:
        viewModel.market?.volume24hUsd != null
          ? formatCompactUsd(viewModel.market.volume24hUsd)
          : null,
    },
    {
      label: "FDV",
      value:
        viewModel.market?.fdvUsd != null ? formatCompactUsd(viewModel.market.fdvUsd) : null,
    },
    {
      label: "Holders",
      value:
        viewModel.market?.holderCount != null
          ? new Intl.NumberFormat("en-US").format(viewModel.market.holderCount)
          : null,
    },
  ].filter((row) => row.value !== null);
  const linkRows = [
    { label: "Website", url: viewModel.links?.website ?? null },
    { label: "Twitter", url: viewModel.links?.twitter ?? null },
    { label: "Explorer", url: explorerUrl },
  ].filter((row) => row.url);
  const initialSwapFromMint = viewModel.position.publicBalance > 0 ? viewModel.mint : undefined;
  const initialSwapToMint = viewModel.position.publicBalance > 0 ? undefined : viewModel.mint;
  const shieldActionLabel =
    !viewModel.canShield && viewModel.canUnshield ? "Unshield" : "Shield";

  if (!tokenMint) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-[18px] font-semibold text-black">Token unavailable</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom + 40, 56),
          paddingTop: insets.top + 10,
        }}
      >
        <View className="px-4">
          <View className="mb-5 flex-row items-center justify-between">
            <Pressable
              className="h-11 w-11 items-center justify-center rounded-full"
              style={{ backgroundColor: "#f2f2ee" }}
              onPress={() => router.back()}
            >
              <ArrowLeft size={20} color="#111111" />
            </Pressable>
            <View className="flex-row gap-2">
              <Pressable
                className="h-11 w-11 items-center justify-center rounded-full"
                style={{ backgroundColor: "#f2f2ee" }}
                onPress={handleCopyMint}
              >
                <Copy size={18} color="#111111" />
              </Pressable>
              <Pressable
                className="h-11 w-11 items-center justify-center rounded-full"
                style={{ backgroundColor: "#f2f2ee" }}
                onPress={handleShareMint}
              >
                <Share2 size={18} color="#111111" />
              </Pressable>
            </View>
          </View>

          <View className="rounded-[32px] px-5 py-6" style={SECTION_CARD_STYLE}>
            <View className="flex-row items-center">
              <Image
                source={viewModel.token.icon}
                style={{ width: 56, height: 56, borderRadius: 28 }}
              />
              <View className="ml-4 flex-1">
                <Text className="text-[26px] font-semibold text-black">
                  {viewModel.token.name}
                </Text>
                <Text className="mt-1 text-[14px] uppercase" style={{ color: MUTED_TEXT }}>
                  {viewModel.token.symbol}
                </Text>
              </View>
            </View>

            <View className="mt-6 flex-row items-end justify-between">
              <View>
                <Text className="text-[30px] font-semibold text-black">
                  {loading && spotPrice === null ? "Loading..." : formatCurrency(spotPrice)}
                </Text>
                <Text
                  className="mt-1 text-[14px] font-medium"
                  style={{
                    color:
                      (viewModel.market?.priceChange24hPercent ?? 0) >= 0 ? GREEN : "#111111",
                  }}
                >
                  {loading && viewModel.market?.priceChange24hPercent == null
                    ? "Fetching 24H move"
                    : formatPercent(viewModel.market?.priceChange24hPercent ?? null)}
                </Text>
              </View>

              <View className="items-end">
                <Text className="text-[12px]" style={{ color: MUTED_TEXT }}>
                  Mint
                </Text>
                <Text className="mt-1 text-[13px] font-medium text-black">
                  {formatMint(tokenMint)}
                </Text>
              </View>
            </View>

            <TokenLineChart loading={loading} points={viewModel.chart} />
          </View>

          {showUnavailable ? (
            <View className="mt-4 rounded-[28px] p-6" style={SECTION_CARD_STYLE}>
              <Text className="text-[20px] font-semibold text-black">Token unavailable</Text>
              <Text className="mt-2 text-[14px]" style={{ color: MUTED_TEXT }}>
                We could not load local wallet data or market data for this token yet.
              </Text>
              <Text className="mt-4 text-[13px] font-medium text-black">{tokenMint}</Text>
              <Pressable
                className="mt-5 flex-row items-center justify-center gap-2 rounded-full py-3"
                style={{ backgroundColor: "rgba(249, 115, 98, 0.14)" }}
                onPress={() => void reload()}
              >
                <RefreshCw size={16} color={CORAL} />
                <Text className="text-[14px] font-medium" style={{ color: CORAL }}>
                  Retry
                </Text>
              </Pressable>
            </View>
          ) : null}

          <View className="mt-6 flex-row justify-center gap-8 px-2">
            <ActionRailButton
              icon={<ArrowUp size={28} color="#000" strokeWidth={1.5} />}
              label="Send"
              onPress={() => setIsSendOpen(true)}
              disabled={!viewModel.canSend}
            />
            <ActionRailButton
              icon={<ArrowDown size={28} color="#000" strokeWidth={1.5} />}
              label="Receive"
              onPress={() => setIsReceiveOpen(true)}
            />
            <ActionRailButton
              icon={<ArrowLeftRight size={28} color="#000" strokeWidth={1.5} />}
              label="Swap"
              onPress={() => setIsSwapOpen(true)}
            />
            <ActionRailButton
              icon={<Shield size={28} color="#000" strokeWidth={1.5} />}
              label={shieldActionLabel}
              onPress={() => setIsShieldOpen(true)}
              disabled={!viewModel.canShield && !viewModel.canUnshield}
              muted={!viewModel.canShield}
            />
          </View>

          <View className="mt-6 gap-4">
            <SectionCard
              title="Your Position"
              subtitle="Local wallet balances update immediately."
            >
              {showEmptyPosition ? (
                <View
                  className="rounded-[22px] px-4 py-4"
                  style={{ backgroundColor: "#efefea" }}
                >
                  <Text className="text-[15px] font-medium text-black">
                    You don&apos;t hold this token yet
                  </Text>
                  <Text className="mt-1 text-[13px]" style={{ color: MUTED_TEXT }}>
                    Receive, swap, or unshield into this asset when you&apos;re ready.
                  </Text>
                </View>
              ) : (
                <>
                  <View
                    className="mb-4 rounded-[22px] px-4 py-4"
                    style={{ backgroundColor: "#efefea" }}
                  >
                    <Text className="text-[12px]" style={{ color: MUTED_TEXT }}>
                      Total
                    </Text>
                    <Text className="mt-1 text-[28px] font-semibold text-black">
                      {formatBalance(viewModel.position.totalBalance)} {viewModel.token.symbol}
                    </Text>
                    <Text className="mt-4 text-[12px]" style={{ color: MUTED_TEXT }}>
                      Value
                    </Text>
                    <Text className="mt-1 text-[24px] font-semibold" style={{ color: CORAL }}>
                      {formatCurrency(viewModel.position.totalValueUsd)}
                    </Text>
                  </View>
                  <StatRow
                    label="Public"
                    value={`${formatBalance(viewModel.position.publicBalance)} ${viewModel.token.symbol}`}
                  />
                  <StatRow
                    label="Shielded"
                    value={`${formatBalance(viewModel.position.shieldedBalance)} ${viewModel.token.symbol}`}
                  />
                </>
              )}
            </SectionCard>

            <SectionCard
              title="Market Stats"
              subtitle={loading ? "Fetching market data." : "Free-tier market snapshot."}
            >
              {marketRows.length > 0 ? (
                marketRows.map((row) => (
                  <StatRow key={row.label} label={row.label} value={row.value as string} />
                ))
              ) : (
                <Text className="text-[14px]" style={{ color: MUTED_TEXT }}>
                  Market stats unavailable right now.
                </Text>
              )}
              {!loading && !viewModel.market && error ? (
                <Text className="pt-2 text-[13px]" style={{ color: MUTED_TEXT }}>
                  {error}
                </Text>
              ) : null}
            </SectionCard>

            {linkRows.length > 0 ? (
              <SectionCard
                title="Links"
                subtitle="Official links when available."
              >
                {linkRows.map((row) => (
                  <LinkRow key={row.label} label={row.label} url={row.url} />
                ))}
              </SectionCard>
            ) : null}

            <View className="rounded-[28px] px-2 py-1" style={SECTION_CARD_STYLE}>
              <ActivityFeed
                transactions={viewModel.activity as Transaction[]}
                tokenHoldings={tokenHoldings}
                isLoading={isFetchingTransactions && viewModel.activity.length === 0}
                onTransactionPress={handleTransactionPress}
                onShowAll={() => undefined}
                maxItems={999}
              />
            </View>
          </View>
        </View>
      </ScrollView>

      <SendSheet
        open={isSendOpen}
        onClose={() => setIsSendOpen(false)}
        solBalanceLamports={solBalanceLamports}
        solPriceUsd={solPriceUsd}
        tokenHoldings={tokenHoldings}
        onSendComplete={handleSendComplete}
        initialMint={viewModel.canSend ? viewModel.mint : undefined}
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
        initialFromMint={initialSwapFromMint}
        initialToMint={initialSwapToMint}
      />

      <ShieldSheet
        open={isShieldOpen}
        onClose={() => setIsShieldOpen(false)}
        walletAddress={walletAddress}
        tokenHoldings={tokenHoldings}
        onShieldComplete={handleShieldComplete}
        initialMint={viewModel.mint}
      />

      <TransactionDetailsSheet
        ref={txDetailsSheetRef}
        transaction={selectedTransaction}
      />
    </View>
  );
}
