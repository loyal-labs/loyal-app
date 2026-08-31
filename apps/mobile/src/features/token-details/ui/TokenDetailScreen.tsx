import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Globe,
  MessageCircle,
  RefreshCw,
  ScanLine,
  Send,
} from "lucide-react-native";
import {
  type ComponentRef,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Linking,
  Image as RNImage,
  View as MeasureView,
} from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ReceiveSheet } from "@/components/wallet/ReceiveSheet";
import { SendSheet } from "@/components/wallet/SendSheet";
import { SwapSheet } from "@/components/wallet/SwapSheet";
import { splitUsd } from "@/features/wallet-categories/model/format";
import { ActionBarButton } from "@/features/wallet-categories/ui/ActionBarButton";
import {
  type MoreActionsAnchor,
  MoreActionsSheet,
} from "@/features/wallet-categories/ui/MoreActionsSheet";
import { useSolPrice } from "@/hooks/wallet/useSolPrice";
import { useTokenDetails } from "@/hooks/wallet/useTokenDetails";
import { useTokenHoldings } from "@/hooks/wallet/useTokenHoldings";
import { useWalletBalance } from "@/hooks/wallet/useWalletBalance";
import { useWalletInit } from "@/hooks/wallet/useWalletInit";
import { formatUsdSpotPrice } from "@/lib/solana/token-holdings/format-usd-price";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import type { TokenDetailTimeframe } from "@/services/api";
import { Pressable, ScrollView, Text, View } from "@/tw";

import {
  buildTokenChartCoordinates,
  buildTokenChartSplinePath,
  downsampleTokenChartPoints,
  formatTokenChartTimeLabel,
  getTokenChartPointIndex,
} from "../chart";
import { useTokenDetail } from "../useTokenDetail";
import type { TokenDetailViewModel } from "../view-model";
import { TokenVerificationSheet } from "./TokenVerificationSheet";

import EllipsisIcon from "../../../../assets/images/icons/ellipsis.svg";
import UnverifiedBadgeIcon from "../../../../assets/images/icons/unverified_badge_24.svg";
import VerifiedBadgeIcon from "../../../../assets/images/icons/verified_badge_24.svg";
import XLogoIcon from "../../../../assets/images/icons/x_logo_20.svg";


const MUTED = "rgba(60, 60, 67, 0.6)";
const DIM = "rgba(60, 60, 67, 0.4)";
const POSITIVE = "#34C759";
const NEGATIVE = "#F9363C";
const CHIP_BG = "#f5f5f5";
const ICON_BORDER = "rgba(0, 0, 0, 0.08)";

const CHART_HEIGHT = 200;
// Clearance so the line's end dot never clips against the SVG bounds.
const CHART_DOT_CLEARANCE = 6;

const TIMEFRAMES: { key: TokenDetailTimeframe; label: string }[] = [
  { key: "1d", label: "1D" },
  { key: "1w", label: "1W" },
  { key: "1m", label: "1M" },
  { key: "1y", label: "1Y" },
];

function formatCompactUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCompactCount(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatUsdValue(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
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

function formatPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

// "$73.65" -> { whole: "$73", decimals: ".65" } so the fraction renders dimmed.
function splitSpotPrice(value: number | null) {
  const formatted = formatUsdSpotPrice(value);
  const dotIndex = formatted.indexOf(".");
  if (dotIndex === -1) {
    return { whole: formatted, decimals: "" };
  }
  return {
    whole: formatted.slice(0, dotIndex),
    decimals: formatted.slice(dotIndex),
  };
}

function websiteLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

function twitterHandle(url: string) {
  const handle = url.replace(/\/$/, "").split("/").pop();
  return handle ? `@${handle}` : "X";
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

function buildStatChips(
  market: TokenDetailViewModel["market"],
  info: TokenDetailViewModel["info"],
) {
  const top10 = info?.holderDistribution
    ? Number.parseFloat(info.holderDistribution.top10)
    : null;
  const chips = [
    {
      label: "MCAP",
      value: market?.marketCapUsd != null ? formatCompactUsd(market.marketCapUsd) : null,
    },
    {
      label: "24H VOL",
      value: market?.volume24hUsd != null ? formatCompactUsd(market.volume24hUsd) : null,
    },
    {
      label: "LIQ",
      value: market?.liquidityUsd != null ? formatCompactUsd(market.liquidityUsd) : null,
    },
    {
      label: "HLDRS",
      value: market?.holderCount != null ? formatCompactCount(market.holderCount) : null,
    },
    {
      label: "TOP10",
      value: top10 != null && Number.isFinite(top10) ? `${top10.toFixed(2)}%` : null,
    },
    {
      label: "FDV",
      value: market?.fdvUsd != null ? formatCompactUsd(market.fdvUsd) : null,
    },
  ];

  return chips.filter(
    (chip): chip is { label: string; value: string } => chip.value !== null,
  );
}

function TokenLineChart({
  loading,
  points,
  activePointIndex,
  onActivePointIndexChange,
  onInteractionChange,
}: {
  loading: boolean;
  points: { timestamp: number; priceUsd: number }[];
  activePointIndex: number | null;
  onActivePointIndexChange: (index: number | null) => void;
  onInteractionChange: (isInteracting: boolean) => void;
}) {
  const [chartWidth, setChartWidth] = useState(0);
  const plotWidth = Math.max(chartWidth - CHART_DOT_CLEARANCE, 0);
  const handleSetActivePoint = useCallback(
    (locationX: number) => {
      const nextIndex = getTokenChartPointIndex(points, plotWidth, locationX);
      onActivePointIndexChange(nextIndex);
    },
    [plotWidth, onActivePointIndexChange, points],
  );
  // Downsample raw points (often 1/min over 24h = 1440) into ~120 buckets so
  // sub-bucket noise stops dominating the line shape, then render with a
  // monotone cubic spline so the result reads as a smooth trend curve.
  const smoothedPoints = useMemo(
    () => downsampleTokenChartPoints(points, 120),
    [points],
  );

  if (points.length === 0) {
    return (
      <View style={{ height: CHART_HEIGHT }} className="items-center justify-center">
        {loading ? (
          <ActivityIndicator color={MUTED} />
        ) : (
          <Text className="text-[13px]" style={{ color: MUTED }}>
            Chart unavailable
          </Text>
        )}
      </View>
    );
  }

  const lineColor =
    points[points.length - 1].priceUsd >= points[0].priceUsd ? POSITIVE : NEGATIVE;
  const coordinates = buildTokenChartCoordinates(
    smoothedPoints,
    plotWidth,
    CHART_HEIGHT,
    { topInset: 4, bottomInset: 4 },
  );
  const path = buildTokenChartSplinePath(coordinates);
  // The scrub indexes into the RAW point array (parent passes raw index in).
  // Map that back to the nearest smoothed coord so the dot sits on the curve.
  const activeSmoothedIdx =
    activePointIndex != null && points.length > 1 && smoothedPoints.length > 1
      ? Math.min(
          smoothedPoints.length - 1,
          Math.round(
            (activePointIndex / (points.length - 1)) *
              (smoothedPoints.length - 1),
          ),
        )
      : null;
  const activePoint =
    activeSmoothedIdx != null && coordinates[activeSmoothedIdx]
      ? coordinates[activeSmoothedIdx]
      : null;
  const lastPoint = coordinates[coordinates.length - 1] ?? null;

  return (
    <View
      style={{ height: CHART_HEIGHT, marginRight: 16 }}
      onLayout={(event) => {
        setChartWidth(event.nativeEvent.layout.width);
      }}
      onMoveShouldSetResponderCapture={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => {
        onInteractionChange(true);
        handleSetActivePoint(event.nativeEvent.locationX);
      }}
      onResponderMove={(event) => {
        handleSetActivePoint(event.nativeEvent.locationX);
      }}
      onResponderRelease={() => {
        onInteractionChange(false);
        onActivePointIndexChange(null);
      }}
      onResponderTerminate={() => {
        onInteractionChange(false);
        onActivePointIndexChange(null);
      }}
      onStartShouldSetResponderCapture={() => true}
      onStartShouldSetResponder={() => true}
    >
      {chartWidth > 0 ? (
        <Svg width={chartWidth} height={CHART_HEIGHT}>
          {path ? (
            <Path
              d={path}
              fill="none"
              stroke={lineColor}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {activePoint ? (
            <>
              {/* Dim everything to the right of the finger (Figma 316:9545). */}
              <Rect
                x={activePoint.x}
                y={0}
                width={Math.max(chartWidth - activePoint.x, 0)}
                height={CHART_HEIGHT}
                fill="rgba(255, 255, 255, 0.6)"
              />
              <Line
                x1={activePoint.x}
                y1={0}
                x2={activePoint.x}
                y2={CHART_HEIGHT}
                stroke="rgba(0, 0, 0, 0.2)"
                strokeWidth={1}
              />
              <Circle
                cx={activePoint.x}
                cy={activePoint.y}
                r={4}
                fill={lineColor}
                stroke="#ffffff"
                strokeWidth={2}
              />
            </>
          ) : lastPoint ? (
            <Circle cx={lastPoint.x} cy={lastPoint.y} r={4} fill={lineColor} />
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <View
      className="justify-center rounded-[12px] px-3 py-2"
      style={{ backgroundColor: CHIP_BG }}
    >
      <Text className="text-[13px]" style={{ color: MUTED, lineHeight: 16 }}>
        {label}
      </Text>
      <Text
        className="text-[17px] font-medium text-black"
        style={{ letterSpacing: -0.187, lineHeight: 22 }}
      >
        {value}
      </Text>
    </View>
  );
}

function GroupHeader({ title }: { title: string }) {
  return (
    <View className="px-4 pb-2 pt-3">
      <Text
        className="text-[17px] font-semibold text-black"
        style={{ letterSpacing: -0.187, lineHeight: 22 }}
      >
        {title}
      </Text>
    </View>
  );
}

function LinkChip({
  icon,
  label,
  href,
}: {
  icon: ReactNode;
  label: string;
  href: string;
}) {
  const handlePress = useCallback(() => {
    void Linking.openURL(href);
  }, [href]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="link"
      accessibilityLabel={label}
      className="flex-row items-center gap-2 rounded-[12px] px-3 py-2"
      style={{ backgroundColor: CHIP_BG }}
    >
      {icon}
      <Text
        className="text-[15px] font-medium text-black"
        style={{ letterSpacing: -0.165, lineHeight: 20 }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function BalanceRow({
  icon,
  title,
  amountText,
  usdText,
  showConnector,
}: {
  icon: string;
  title: string;
  amountText: string;
  usdText: string;
  showConnector?: boolean;
}) {
  return (
    <View className="flex-row items-center px-4">
      <View className="py-1.5 pr-3" style={{ position: "relative" }}>
        <RNImage
          source={{ uri: icon }}
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: "#f2f2f7",
            borderWidth: 0.5,
            borderColor: ICON_BORDER,
          }}
        />
        {showConnector ? (
          <View
            style={{
              position: "absolute",
              left: 23,
              top: 54,
              width: 2,
              height: 18,
              borderRadius: 2,
              backgroundColor: "rgba(0, 0, 0, 0.14)",
            }}
          />
        ) : null}
      </View>
      <View className="flex-1 py-2">
        <Text
          className="text-[17px] font-medium text-black"
          style={{ letterSpacing: -0.187, lineHeight: 22 }}
        >
          {title}
        </Text>
        <Text className="mt-0.5 text-[15px]" style={{ color: MUTED, lineHeight: 20 }}>
          {amountText}
        </Text>
      </View>
      <View className="items-end pl-3">
        <Text
          className="text-[17px] font-medium text-black"
          style={{ letterSpacing: -0.187, lineHeight: 22 }}
        >
          {usdText}
        </Text>
      </View>
    </View>
  );
}

function AboutSection({
  description,
  links,
}: {
  description: string | null;
  links: TokenDetailViewModel["links"];
}) {
  const [expanded, setExpanded] = useState(false);
  const hasLinks = Boolean(
    links &&
      (links.website || links.twitter || links.discord || links.telegram || links.explorer),
  );
  if (!description && !hasLinks) {
    return null;
  }
  return (
    <View>
      <GroupHeader title="About" />
      {description ? (
        <Pressable className="px-4 pb-4" onPress={() => setExpanded((v) => !v)}>
          <Text
            className="text-[15px]"
            style={{ color: MUTED, lineHeight: 20 }}
            numberOfLines={expanded ? undefined : 3}
          >
            {description}
          </Text>
        </Pressable>
      ) : null}
      {hasLinks && links ? (
        <View className="flex-row flex-wrap gap-2 px-4 pb-4">
          {links.website ? (
            <LinkChip
              href={links.website}
              icon={<Globe size={20} color="#000000" strokeWidth={1.8} />}
              label={websiteLabel(links.website)}
            />
          ) : null}
          {links.twitter ? (
            <LinkChip
              href={links.twitter}
              icon={<XLogoIcon width={20} height={20} />}
              label={twitterHandle(links.twitter)}
            />
          ) : null}
          {links.discord ? (
            <LinkChip
              href={links.discord}
              icon={<MessageCircle size={20} color="#000000" strokeWidth={1.8} />}
              label="Discord"
            />
          ) : null}
          {links.telegram ? (
            <LinkChip
              href={links.telegram}
              icon={<Send size={20} color="#000000" strokeWidth={1.8} />}
              label="Telegram"
            />
          ) : null}
          {links.explorer ? (
            <LinkChip
              href={links.explorer}
              icon={<ArrowUpRight size={20} color="#000000" strokeWidth={1.8} />}
              label="Solscan"
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function TokenDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { mint } = useLocalSearchParams<{ mint: string }>();
  const tokenMint = Array.isArray(mint) ? mint[0] : mint;

  const [isSendOpen, setIsSendOpen] = useState(false);
  const [scanOnOpen, setScanOnOpen] = useState(false);
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);
  const [isSwapOpen, setIsSwapOpen] = useState(false);
  const [isVerifySheetOpen, setIsVerifySheetOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [moreAnchor, setMoreAnchor] = useState<MoreActionsAnchor | null>(null);
  const moreButtonRef = useRef<ComponentRef<typeof MeasureView>>(null);
  const [timeframe, setTimeframe] = useState<TokenDetailTimeframe>("1d");
  const [activeChartPointIndex, setActiveChartPointIndex] = useState<number | null>(null);
  const [isChartInteracting, setIsChartInteracting] = useState(false);
  const [showBarTitle, setShowBarTitle] = useState(false);

  const { walletAddress } = useWalletInit();
  const { solBalanceLamports, refreshBalance } = useWalletBalance(walletAddress);
  const { solPriceUsd } = useSolPrice();
  const { tokenHoldings, refreshTokenHoldings } = useTokenHoldings(walletAddress);
  // Feed the same CoinGecko-backed token-detail cache the home screen uses,
  // so sheets launched from here (send/swap) can resolve icons via
  // `detailLogoUrl` rather than falling back to Helius metadata or the
  // SOL-logo placeholder.
  const sheetTokenDetailMints = useMemo(
    () => Array.from(new Set(tokenHoldings.map((h) => h.mint))),
    [tokenHoldings],
  );
  const tokenDetailsByMint = useTokenDetails(sheetTokenDetailMints);

  const {
    viewModel,
    loading,
    error,
    reload,
  } = useTokenDetail({
    mint: tokenMint ?? "",
    holdings: tokenHoldings,
    transactions: [],
    timeframe,
  });

  const handleRefreshWalletData = useCallback(async () => {
    await Promise.all([
      refreshBalance(true),
      refreshTokenHoldings(true),
      reload(),
    ]);
  }, [refreshBalance, refreshTokenHoldings, reload]);

  const handleActionComplete = useCallback(() => {
    void handleRefreshWalletData();
  }, [handleRefreshWalletData]);

  const handleChartInteractionChange = useCallback((isInteracting: boolean) => {
    setIsChartInteracting(isInteracting);
  }, []);

  const handleTimeframeChange = useCallback((next: TokenDetailTimeframe) => {
    void Haptics.selectionAsync();
    setActiveChartPointIndex(null);
    setTimeframe(next);
  }, []);

  const handleBackPress = useCallback(() => {
    router.back();
  }, [router]);

  const localHasData = viewModel.position.totalBalance > 0;
  const marketHasData = viewModel.market !== null || viewModel.chart.length > 0;
  const showUnavailable = !loading && !localHasData && !marketHasData;

  const spotPrice = resolveSpotPrice(
    tokenMint ?? "",
    tokenHoldings,
    viewModel.market?.priceUsd ?? null,
  );
  const activeChartPoint =
    activeChartPointIndex != null ? viewModel.chart[activeChartPointIndex] ?? null : null;
  const price = splitSpotPrice(activeChartPoint?.priceUsd ?? spotPrice);
  const changePercent = viewModel.market?.priceChange24hPercent ?? null;
  const statChips = buildStatChips(viewModel.market, viewModel.info);
  const chartPrices = viewModel.chart.map((point) => point.priceUsd);
  const chartHigh = chartPrices.length > 0 ? Math.max(...chartPrices) : null;
  const chartLow = chartPrices.length > 0 ? Math.min(...chartPrices) : null;

  const { position, token } = viewModel;
  const totalUsd =
    position.totalValueUsd ??
    (spotPrice !== null ? position.totalBalance * spotPrice : null);
  const totalUsdParts = totalUsd !== null ? splitUsd(totalUsd) : null;
  const initialSwapFromMint = position.totalBalance > 0 ? viewModel.mint : undefined;
  const initialSwapToMint = position.totalBalance > 0 ? undefined : viewModel.mint;

  if (!tokenMint) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-[18px] font-semibold text-black">Token unavailable</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      {/* App bar: back / (scrolled title) / scan */}
      <View
        className="z-10 flex-row items-center bg-white px-4 pb-2"
        style={{ paddingTop: insets.top + 8 }}
      >
        <Pressable
          onPress={handleBackPress}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: "#f2f2f7" }}
          hitSlop={8}
        >
          <ArrowLeft size={24} color="#1C1C1E" strokeWidth={2} />
        </Pressable>
        <View className="flex-1 items-center px-3">
          {showBarTitle ? (
            <Text
              className="text-[17px] font-semibold text-black"
              style={{ letterSpacing: -0.187, lineHeight: 22 }}
              numberOfLines={1}
            >
              {token.symbol} — {formatUsdSpotPrice(spotPrice)}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => {
            void Haptics.selectionAsync();
            setScanOnOpen(true);
            setIsSendOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Scan QR code"
          className="h-11 w-11 items-center justify-center rounded-full"
          hitSlop={8}
        >
          <ScanLine size={28} color="#3C3C43" strokeWidth={1.8} opacity={0.6} />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingBottom: 16 }}
        scrollEnabled={!isChartInteracting}
        scrollEventThrottle={32}
        onScroll={(event) => {
          setShowBarTitle(event.nativeEvent.contentOffset.y > 96);
        }}
      >
        {/* Token identity + price */}
        <View className="px-4 pb-2">
          <View className="flex-row items-center">
            <View className="py-2 pr-3">
              {/*
                Hold off rendering the icon until the token detail endpoint
                has resolved, matching the token list placeholder behavior —
                avoids a visible source swap on SOL where Helius and market
                logo URLs diverge.
              */}
              {loading && !viewModel.market ? (
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: "rgba(0, 0, 0, 0.04)",
                  }}
                />
              ) : (
                <Image
                  source={token.icon}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    borderWidth: 0.5,
                    borderColor: ICON_BORDER,
                  }}
                />
              )}
            </View>
            <View className="flex-1 py-2">
              <Text
                className="text-[15px] uppercase"
                style={{ color: MUTED, lineHeight: 20 }}
              >
                {token.symbol}
              </Text>
              <View className="flex-row items-center gap-1">
                <Text
                  className="text-[20px] font-medium text-black"
                  style={{ letterSpacing: -0.22, lineHeight: 24 }}
                  numberOfLines={1}
                >
                  {token.name}
                </Text>
                {viewModel.info ? (
                  <Pressable
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setIsVerifySheetOpen(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={
                      viewModel.info.gtVerified
                        ? "Verified token"
                        : "Unverified token"
                    }
                    hitSlop={8}
                  >
                    {viewModel.info.gtVerified ? (
                      <VerifiedBadgeIcon width={24} height={24} />
                    ) : (
                      <UnverifiedBadgeIcon width={24} height={24} />
                    )}
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
          <View className="flex-row items-baseline gap-3">
            <Text
              className="text-[40px] font-semibold text-black"
              style={{ letterSpacing: -0.44, lineHeight: 48 }}
            >
              {price.whole}
              <Text style={{ color: DIM }}>{price.decimals}</Text>
            </Text>
            {changePercent !== null && Number.isFinite(changePercent) ? (
              <Text
                className="text-[17px]"
                style={{
                  color: changePercent >= 0 ? POSITIVE : NEGATIVE,
                  lineHeight: 22,
                }}
              >
                {formatPercent(changePercent)}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Chart: high label / plot / low label / timeframe pills */}
        <View className="pb-4">
          <View className="flex-row items-center justify-between px-4 pb-1">
            <Text className="text-[15px]" style={{ color: MUTED, lineHeight: 20 }}>
              {activeChartPoint
                ? formatTokenChartTimeLabel(activeChartPoint.timestamp)
                : ""}
            </Text>
            <Text className="text-[15px]" style={{ color: MUTED, lineHeight: 20 }}>
              {chartHigh !== null ? formatUsdSpotPrice(chartHigh) : ""}
            </Text>
          </View>
          <TokenLineChart
            loading={loading}
            points={viewModel.chart}
            activePointIndex={activeChartPointIndex}
            onActivePointIndexChange={setActiveChartPointIndex}
            onInteractionChange={handleChartInteractionChange}
          />
          <View className="flex-row justify-end px-4 pt-1">
            <Text className="text-[15px]" style={{ color: MUTED, lineHeight: 20 }}>
              {chartLow !== null ? formatUsdSpotPrice(chartLow) : ""}
            </Text>
          </View>
          <View className="flex-row items-center gap-2 px-4 pt-2">
            {TIMEFRAMES.map((option) => {
              const active = option.key === timeframe;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => handleTimeframeChange(option.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Chart timeframe ${option.label}`}
                  accessibilityState={{ selected: active }}
                  className="flex-1 items-center justify-center rounded-full px-3 py-1.5"
                  style={{
                    backgroundColor: active ? "rgba(0, 0, 0, 0.04)" : "transparent",
                  }}
                >
                  <Text
                    className="text-[14px] font-medium"
                    style={{ color: active ? "#000000" : MUTED, lineHeight: 20 }}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {showUnavailable ? (
          <View className="px-4 py-4">
            <Text
              className="text-[17px] font-semibold text-black"
              style={{ letterSpacing: -0.187, lineHeight: 22 }}
            >
              Token unavailable
            </Text>
            <Text className="mt-1 text-[15px]" style={{ color: MUTED, lineHeight: 20 }}>
              We could not load wallet or market data for this token yet.
            </Text>
            <Text className="mt-2 text-[13px]" style={{ color: MUTED }} numberOfLines={1}>
              {tokenMint}
            </Text>
            {error ? (
              <Text className="mt-1 text-[13px]" style={{ color: MUTED }}>
                {error}
              </Text>
            ) : null}
            <Pressable
              onPress={() => void reload()}
              accessibilityRole="button"
              accessibilityLabel="Retry"
              className="mt-4 h-[50px] flex-row items-center justify-center gap-2 rounded-full"
              style={{ backgroundColor: CHIP_BG }}
            >
              <RefreshCw size={20} color="#000000" strokeWidth={2} />
              <Text className="text-[17px] font-medium text-black" style={{ lineHeight: 22 }}>
                Retry
              </Text>
            </Pressable>
          </View>
        ) : null}

        {statChips.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="pb-4"
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
          >
            {statChips.map((chip) => (
              <StatChip key={chip.label} label={chip.label} value={chip.value} />
            ))}
          </ScrollView>
        ) : null}

        {position.totalBalance > 0 ? (
          <View className="pb-4">
            <GroupHeader title="Balance" />
            <View className="px-4 pb-3">
              {totalUsdParts ? (
                <Text
                  className="text-[32px] font-semibold text-black"
                  style={{ lineHeight: 36 }}
                >
                  {totalUsdParts.whole}
                  <Text style={{ color: DIM }}>{totalUsdParts.cents}</Text>
                </Text>
              ) : null}
              <Text className="mt-1 text-[15px]" style={{ color: MUTED, lineHeight: 20 }}>
                {formatBalance(position.totalBalance)} {token.symbol}
              </Text>
            </View>
            {position.totalBalance > 0 ? (
              <BalanceRow
                icon={token.icon}
                title="Available"
                amountText={`${formatBalance(position.totalBalance)} ${token.symbol}`}
                usdText={
                  spotPrice !== null
                    ? formatUsdValue(position.totalBalance * spotPrice)
                    : "—"
                }
              />
            ) : null}
          </View>
        ) : null}

        <AboutSection
          description={viewModel.info?.description ?? null}
          links={viewModel.links}
        />
      </ScrollView>

      {/* Pinned action bar */}
      <View
        className="flex-row items-center gap-2 px-4 pt-2"
        style={{ paddingBottom: insets.bottom + 8 }}
      >
        <ActionBarButton
          variant="primary"
          label="Send"
          icon={<ArrowUp size={24} color="#FFFFFF" strokeWidth={2} />}
          onPress={() => {
            void Haptics.selectionAsync();
            setScanOnOpen(false);
            setIsSendOpen(true);
          }}
        />
        <ActionBarButton
          variant="secondary"
          label="Receive"
          icon={<ArrowDown size={24} color="#3C3C43" strokeWidth={2} opacity={0.6} />}
          onPress={() => {
            void Haptics.selectionAsync();
            setIsReceiveOpen(true);
          }}
        />
        <MeasureView ref={moreButtonRef} collapsable={false}>
          <ActionBarButton
            variant="secondary"
            icon={<EllipsisIcon width={24} height={24} />}
            onPress={() => {
              moreButtonRef.current?.measureInWindow((x, y, width, height) => {
                setMoreAnchor({ x, y, width, height });
                setIsMoreOpen(true);
              });
            }}
          />
        </MeasureView>
      </View>

      <SendSheet
        open={isSendOpen}
        onClose={() => setIsSendOpen(false)}
        solBalanceLamports={solBalanceLamports}
        solPriceUsd={solPriceUsd}
        tokenHoldings={tokenHoldings}
        tokenDetailsByMint={tokenDetailsByMint}
        onSendComplete={handleActionComplete}
        initialMint={viewModel.mint}
        initialShowScanner={scanOnOpen}
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
        onSwapComplete={handleActionComplete}
        initialFromMint={initialSwapFromMint}
        initialToMint={initialSwapToMint}
      />

      <MoreActionsSheet
        open={isMoreOpen}
        onClose={() => setIsMoreOpen(false)}
        anchor={moreAnchor}
        onSend={() => {
          setScanOnOpen(false);
          setIsSendOpen(true);
        }}
        onReceive={() => setIsReceiveOpen(true)}
        onSwap={() => setIsSwapOpen(true)}
      />

      <TokenVerificationSheet
        open={isVerifySheetOpen}
        onClose={() => setIsVerifySheetOpen(false)}
        verified={viewModel.info?.gtVerified ?? false}
      />
    </View>
  );
}
