import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  ExternalLink,
  Globe,
  MessageCircle,
  RefreshCw,
  Send,
  Shield,
  ShieldCheck,
  ShieldOff,
  Twitter,
  Zap,
} from "lucide-react-native";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Linking } from "react-native";
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient as SvgLinearGradient,
  Path,
  Stop,
} from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ReceiveSheet } from "@/components/wallet/ReceiveSheet";
import { SendSheet } from "@/components/wallet/SendSheet";
import { ShieldSheet } from "@/components/wallet/ShieldSheet";
import { SwapSheet } from "@/components/wallet/SwapSheet";
import { useSolPrice } from "@/hooks/wallet/useSolPrice";
import { useTokenApy } from "@/hooks/wallet/useTokenApy";
import { useTokenDetails } from "@/hooks/wallet/useTokenDetails";
import { useTokenHoldings } from "@/hooks/wallet/useTokenHoldings";
import { useWalletBalance } from "@/hooks/wallet/useWalletBalance";
import { useWalletInit } from "@/hooks/wallet/useWalletInit";
import type { ShieldDirection } from "@/lib/solana/shielding";
import { formatUsdSpotPrice } from "@/lib/solana/token-holdings/format-usd-price";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
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

const PRICE_CARD_BACKGROUND = "#f6f6f2";
const PRICE_CARD_STYLE = { backgroundColor: PRICE_CARD_BACKGROUND };
const SECTION_CARD_STYLE = {
  backgroundColor: "#ffffff",
  borderColor: "#f2f2f7",
  borderWidth: 2,
};
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

function buildMarketRows(market: TokenDetailViewModel["market"]) {
  return [
    {
      label: "Market Cap",
      value:
        market?.marketCapUsd != null ? formatCompactUsd(market.marketCapUsd) : null,
    },
    {
      label: "Liquidity",
      value:
        market?.liquidityUsd != null ? formatCompactUsd(market.liquidityUsd) : null,
    },
    {
      label: "24H Volume",
      value:
        market?.volume24hUsd != null ? formatCompactUsd(market.volume24hUsd) : null,
    },
    {
      label: "FDV",
      value: market?.fdvUsd != null ? formatCompactUsd(market.fdvUsd) : null,
    },
  ].filter((row): row is { label: string; value: string } => row.value !== null);
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
  const chartHeight = 128;
  const chartTopInset = 8;
  const chartBottomInset = 12;
  const handleSetActivePoint = useCallback(
    (locationX: number) => {
      const nextIndex = getTokenChartPointIndex(points, chartWidth, locationX);
      onActivePointIndexChange(nextIndex);
    },
    [chartWidth, onActivePointIndexChange, points],
  );
  // Downsample raw points (often 1/min over 24h = 1440) into ~120 buckets so
  // sub-bucket noise stops dominating the line shape, then render with a
  // monotone cubic spline so the result reads as a smooth trend curve.
  const smoothedPoints = useMemo(
    () => downsampleTokenChartPoints(points, 120),
    [points],
  );

  if (loading && points.length === 0) {
    return (
      <View className="mt-6 h-[152px] items-center justify-center">
        <ActivityIndicator color={CORAL} />
        <Text className="mt-2 text-[13px]" style={{ color: MUTED_TEXT }}>
          Loading 24H chart
        </Text>
      </View>
    );
  }

  if (points.length === 0) {
    return (
      <View className="mt-6 h-[152px] items-center justify-center">
        <Text className="text-[13px]" style={{ color: MUTED_TEXT }}>
          Chart unavailable
        </Text>
      </View>
    );
  }

  const lineColor = points[points.length - 1].priceUsd >= points[0].priceUsd ? GREEN : CORAL;
  const coordinates = buildTokenChartCoordinates(
    smoothedPoints,
    chartWidth,
    chartHeight,
    { topInset: chartTopInset, bottomInset: chartBottomInset },
  );
  const path = buildTokenChartSplinePath(coordinates);
  // The tooltip indexes into the RAW point array (parent passes raw index in).
  // Map that back to the nearest smoothed coord so the active circle still
  // sits on the rendered curve.
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

  return (
    <View
      className="mt-6 pb-5"
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
        <>
          <Svg width={chartWidth} height={chartHeight}>
            <Defs>
              <SvgLinearGradient id="token-chart-fill" x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor={lineColor} stopOpacity="0.18" />
                <Stop offset="100%" stopColor={lineColor} stopOpacity="0" />
              </SvgLinearGradient>
            </Defs>
            {coordinates.length > 1 ? (
              <Path
                d={`${path} L ${chartWidth.toFixed(2)} ${chartHeight} L 0 ${chartHeight} Z`}
                fill="url(#token-chart-fill)"
              />
            ) : null}
            {path ? (
              <Path
                d={path}
                fill="none"
                stroke={lineColor}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            {activePoint ? (
              <>
                <Line
                  x1={activePoint.x}
                  y1={0}
                  x2={activePoint.x}
                  y2={chartHeight}
                  stroke={lineColor}
                  strokeOpacity={0.24}
                  strokeWidth={1.5}
                />
                <Circle
                  cx={activePoint.x}
                  cy={activePoint.y}
                  r={6}
                  fill="#ffffff"
                  stroke={lineColor}
                  strokeWidth={3}
                />
              </>
            ) : null}
          </Svg>
          <View className="mt-2 items-center px-1">
            <Text className="text-[12px]" style={{ color: MUTED_TEXT }}>
              24H price change
            </Text>
          </View>
        </>
      ) : null}
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
  const handlePress = useCallback(() => {
    if (disabled) {
      return;
    }
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress();
  }, [disabled, onPress]);

  return (
    <Pressable
      className="items-center gap-2"
      onPress={disabled ? undefined : handlePress}
      style={{ opacity: disabled || muted ? 0.45 : 1 }}
      accessibilityState={{ disabled }}
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

/**
 * Stat tile — small muted label stacked over a semibold value. Designed to be
 * placed in a 2-column grid so groups of stats read as a clean dashboard.
 * Optional leadingIcon renders inline with the label (e.g. shield badge).
 */
function StatTile({
  label,
  value,
  leadingIcon,
}: {
  label: string;
  value: string;
  leadingIcon?: ReactNode;
}) {
  return (
    <View
      className="rounded-2xl px-3 py-3"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.03)",
        flexBasis: "48%",
        flexGrow: 1,
      }}
    >
      <View className="flex-row items-center gap-1">
        {leadingIcon}
        <Text
          className="text-[12px]"
          style={{ color: MUTED_TEXT }}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
      <Text
        className="mt-1 text-[15px] font-semibold text-black"
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const ORANGE = "#ff9500";
const APY_TEXT = "#2EA043";
const APY_SURFACE = "rgba(52, 199, 89, 0.10)";

/**
 * Inline earnings callout shown under the Public / Shielded tiles when the
 * user holds a shielded balance of a Kamino-backed mint (USDC today). The
 * green surface and matching Zap icon tie it to the APY pill in the list row
 * so the two surfaces read as the same concept.
 */
function ShieldedApyCallout({
  apyBps,
  tokenSymbol,
}: {
  apyBps: number;
  tokenSymbol: string;
}) {
  const apyText = (apyBps / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    <View
      className="mt-3 flex-row items-center gap-2 rounded-2xl px-3 py-2.5"
      style={{ backgroundColor: APY_SURFACE }}
    >
      <Zap size={14} color={APY_TEXT} fill={APY_TEXT} strokeWidth={2.5} />
      <Text
        className="flex-1 text-[13px]"
        style={{ color: APY_TEXT, letterSpacing: -0.1 }}
      >
        <Text
          className="font-semibold"
          style={{ fontVariant: ["tabular-nums"], color: APY_TEXT }}
        >
          {apyText}% APY
        </Text>
        <Text style={{ color: APY_TEXT }}>
          {` earning on shielded ${tokenSymbol}`}
        </Text>
      </Text>
    </View>
  );
}

function trustScoreColor(score: number) {
  if (score >= 70) return GREEN;
  if (score >= 40) return ORANGE;
  return CORAL;
}

function AuthorityChip({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (value === null) {
    return null;
  }
  const safe = value === "no";
  const color = safe ? GREEN : ORANGE;
  const Icon = safe ? ShieldOff : Shield;
  return (
    <View
      className="flex-row items-center gap-1.5 rounded-[10px] px-2.5 py-1.5"
      style={{ backgroundColor: safe ? "rgba(50, 229, 94, 0.10)" : "rgba(255, 149, 0, 0.10)" }}
    >
      <Icon size={12} color={color} strokeWidth={2} />
      <Text className="text-[11px] font-medium" style={{ color }}>
        {label}: {safe ? "disabled" : "enabled"}
      </Text>
    </View>
  );
}

function LinkRow({
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
      className="flex-row items-center gap-3 rounded-[14px] px-3 py-3"
      onPress={handlePress}
    >
      {icon}
      <Text
        className="flex-1 text-[14px] font-medium text-black"
        numberOfLines={1}
      >
        {label}
      </Text>
      <ExternalLink size={14} color={MUTED_TEXT} strokeWidth={2} />
    </Pressable>
  );
}

function AboutCard({ description }: { description: string }) {
  const [expanded, setExpanded] = useState(false);
  const longEnough = description.length > 220;
  return (
    <SectionCard title="About">
      <Text
        className="text-[14px] leading-[20px] text-black"
        numberOfLines={expanded || !longEnough ? undefined : 4}
      >
        {description}
      </Text>
      {longEnough ? (
        <Pressable className="mt-2" onPress={() => setExpanded((v) => !v)}>
          <Text className="text-[13px] font-medium" style={{ color: CORAL }}>
            {expanded ? "Show less" : "Read more"}
          </Text>
        </Pressable>
      ) : null}
    </SectionCard>
  );
}

function TrustCard({ info }: { info: TokenDetailViewModel["info"] }) {
  if (!info) {
    return null;
  }
  const showAuthority =
    info.mintAuthority !== null || info.freezeAuthority !== null;
  if (!info.gtVerified && info.gtScore === null && !showAuthority) {
    return null;
  }
  return (
    <SectionCard title="Trust">
      <View className="flex-row items-center gap-2">
        {info.gtVerified ? (
          <ShieldCheck size={16} color={GREEN} strokeWidth={2} />
        ) : (
          <Shield size={16} color={MUTED_TEXT} strokeWidth={2} />
        )}
        <Text
          className="text-[14px] font-medium"
          style={{ color: info.gtVerified ? GREEN : MUTED_TEXT }}
        >
          {info.gtVerified ? "Verified by GeckoTerminal" : "Unverified"}
        </Text>
      </View>

      {info.gtScore !== null ? (
        <View className="mt-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-[12px]" style={{ color: MUTED_TEXT }}>
              Trust score
            </Text>
            <Text className="text-[12px] font-medium text-black">
              {info.gtScore.toFixed(1)} / 100
            </Text>
          </View>
          <View
            className="mt-2 h-[6px] overflow-hidden rounded-full"
            style={{ backgroundColor: "rgba(0,0,0,0.06)" }}
          >
            <View
              style={{
                width: `${Math.min(Math.max(info.gtScore, 0), 100)}%`,
                height: "100%",
                backgroundColor: trustScoreColor(info.gtScore),
              }}
            />
          </View>
        </View>
      ) : null}

      {showAuthority ? (
        <View className="mt-4 flex-row flex-wrap gap-2">
          <AuthorityChip label="Mint" value={info.mintAuthority} />
          <AuthorityChip label="Freeze" value={info.freezeAuthority} />
        </View>
      ) : null}
    </SectionCard>
  );
}

function DistributionCard({
  distribution,
  holderCount,
}: {
  distribution: NonNullable<
    NonNullable<TokenDetailViewModel["info"]>["holderDistribution"]
  >;
  holderCount: number | null;
}) {
  const top10 = Number.parseFloat(distribution.top10);
  const rest = Number.parseFloat(distribution.rest);
  if (!Number.isFinite(top10) || !Number.isFinite(rest)) {
    return null;
  }
  const formattedHolders =
    holderCount != null
      ? new Intl.NumberFormat("en-US").format(holderCount)
      : null;
  return (
    <SectionCard title="Holders">
      <View
        className="h-[6px] flex-row overflow-hidden rounded-full"
        style={{ backgroundColor: "rgba(0,0,0,0.06)" }}
      >
        <View
          style={{
            width: `${Math.min(Math.max(top10, 0), 100)}%`,
            backgroundColor: ORANGE,
          }}
        />
      </View>
      <View className="mt-3 flex-row items-center justify-between">
        <Text className="text-[13px]" style={{ color: MUTED_TEXT }}>
          Top 10: {top10.toFixed(1)}%
        </Text>
        <Text className="text-[13px]" style={{ color: MUTED_TEXT }}>
          Rest: {rest.toFixed(1)}%
        </Text>
      </View>
      {formattedHolders ? (
        <Text
          className="mt-3 text-[13px]"
          style={{ color: MUTED_TEXT }}
        >
          {formattedHolders} total holders
        </Text>
      ) : null}
    </SectionCard>
  );
}

function LinksCard({ links }: { links: TokenDetailViewModel["links"] }) {
  if (!links) {
    return null;
  }
  const hasAny =
    links.website || links.twitter || links.discord || links.telegram || links.explorer;
  if (!hasAny) {
    return null;
  }
  const stripUrl = (url: string) =>
    url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <SectionCard title="Links">
      <View className="-mx-1">
        {links.website ? (
          <LinkRow
            href={links.website}
            icon={<Globe size={16} color={MUTED_TEXT} strokeWidth={2} />}
            label={stripUrl(links.website)}
          />
        ) : null}
        {links.twitter ? (
          <LinkRow
            href={links.twitter}
            icon={<Twitter size={16} color={MUTED_TEXT} strokeWidth={2} />}
            label={stripUrl(links.twitter)}
          />
        ) : null}
        {links.discord ? (
          <LinkRow
            href={links.discord}
            icon={<MessageCircle size={16} color={MUTED_TEXT} strokeWidth={2} />}
            label="Discord"
          />
        ) : null}
        {links.telegram ? (
          <LinkRow
            href={links.telegram}
            icon={<Send size={16} color={MUTED_TEXT} strokeWidth={2} />}
            label={stripUrl(links.telegram)}
          />
        ) : null}
        {links.explorer ? (
          <LinkRow
            href={links.explorer}
            icon={<ExternalLink size={16} color={MUTED_TEXT} strokeWidth={2} />}
            label="Solscan"
          />
        ) : null}
      </View>
    </SectionCard>
  );
}

function TokenDetailBody({
  tokenMint,
  viewModel,
  loading,
  error,
  spotPrice,
  activeChartPoint,
  activeChartPointIndex,
  onActiveChartPointIndexChange,
  onChartInteractionChange,
  showUnavailable,
  showEmptyPosition,
  marketRows,
  shieldedApyBps,
  onReceive,
  onReload,
  onSend,
  onShield,
  onUnshield,
  onSwap,
}: {
  tokenMint: string;
  viewModel: TokenDetailViewModel;
  loading: boolean;
  error: string | null;
  spotPrice: number | null;
  activeChartPoint: { timestamp: number; priceUsd: number } | null;
  activeChartPointIndex: number | null;
  onActiveChartPointIndexChange: (index: number | null) => void;
  onChartInteractionChange: (isInteracting: boolean) => void;
  showUnavailable: boolean;
  showEmptyPosition: boolean;
  marketRows: { label: string; value: string }[];
  shieldedApyBps: number | null;
  onReceive: () => void;
  onReload: () => void;
  onSend: () => void;
  onShield: () => void;
  onUnshield: () => void;
  onSwap: () => void;
}) {
  return (
    <>
      <View className="overflow-hidden rounded-[32px]" style={PRICE_CARD_STYLE}>
        <View className="px-5 pb-2 pt-6">
          <View className="flex-row items-center">
            {/*
              Hold off rendering the hero icon until the token detail
              endpoint has resolved. Otherwise we paint the Helius
              imageUrl first and swap to the market logoUrl once the
              request finishes — a visible flash on SOL where the two
              URLs diverge. Match the "other tokens" behavior: show a
              neutral placeholder while the icon source is unknown.
            */}
            {loading && !viewModel.market ? (
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  backgroundColor: "rgba(0,0,0,0.04)",
                }}
              />
            ) : (
              <Image
                source={viewModel.token.icon}
                style={{ width: 56, height: 56, borderRadius: 28 }}
              />
            )}
            <View className="ml-4 flex-1">
              <Text className="text-[26px] font-semibold text-black">
                {viewModel.token.name}
              </Text>
              <Text className="mt-1 text-[14px] uppercase" style={{ color: MUTED_TEXT }}>
                {viewModel.token.symbol}
              </Text>
            </View>
          </View>

          <View className="mt-6">
            <Text className="text-[30px] font-semibold text-black">
              {loading && spotPrice === null
                ? "Loading..."
                : formatUsdSpotPrice(activeChartPoint?.priceUsd ?? spotPrice)}
            </Text>
            <Text
              className="mt-1 text-[14px] font-medium"
              style={{
                color: activeChartPoint
                  ? MUTED_TEXT
                  : (viewModel.market?.priceChange24hPercent ?? 0) >= 0
                    ? GREEN
                    : "#111111",
              }}
            >
              {activeChartPoint
                ? formatTokenChartTimeLabel(activeChartPoint.timestamp)
                : loading && viewModel.market?.priceChange24hPercent == null
                  ? "Fetching 24H move"
                  : formatPercent(viewModel.market?.priceChange24hPercent ?? null)}
            </Text>
          </View>
        </View>

        <TokenLineChart
          loading={loading}
          points={viewModel.chart}
          activePointIndex={activeChartPointIndex}
          onActivePointIndexChange={onActiveChartPointIndexChange}
          onInteractionChange={onChartInteractionChange}
        />
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
            onPress={onReload}
          >
            <RefreshCw size={16} color={CORAL} />
            <Text className="text-[14px] font-medium" style={{ color: CORAL }}>
              Retry
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View className="mt-6 flex-row flex-wrap justify-center gap-6 px-2">
        <ActionRailButton
          icon={<ArrowUp size={28} color="#000" strokeWidth={1.5} />}
          label="Send"
          onPress={onSend}
        />
        <ActionRailButton
          icon={<ArrowDown size={28} color="#000" strokeWidth={1.5} />}
          label="Receive"
          onPress={onReceive}
        />
        <ActionRailButton
          icon={<ArrowLeftRight size={28} color="#000" strokeWidth={1.5} />}
          label="Swap"
          onPress={onSwap}
        />
        <ActionRailButton
          icon={<Shield size={28} color="#000" strokeWidth={1.5} />}
          label="Shield"
          onPress={onShield}
          disabled={!viewModel.canShield}
        />
        <ActionRailButton
          icon={<ShieldOff size={28} color="#000" strokeWidth={1.5} />}
          label="Unshield"
          onPress={onUnshield}
          disabled={!viewModel.canUnshield}
        />
      </View>

      <View className="mt-6 gap-4">
        <SectionCard title="Your Position">
          {showEmptyPosition ? (
            <View
              className="rounded-[22px] px-4 py-4"
              style={{ backgroundColor: PRICE_CARD_BACKGROUND }}
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
              {/* Headline total: balance + USD value side-by-side */}
              <View
                className="rounded-[22px] px-4 py-4"
                style={{
                  backgroundColor: PRICE_CARD_BACKGROUND,
                }}
              >
                <View className="flex-row items-end justify-between gap-3">
                  <View className="flex-1">
                    <Text className="text-[12px]" style={{ color: MUTED_TEXT }}>
                      Total
                    </Text>
                    <Text
                      className="mt-1 text-[24px] font-semibold text-black"
                      numberOfLines={1}
                    >
                      {formatBalance(viewModel.position.totalBalance)}{" "}
                      {viewModel.token.symbol}
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-[12px]" style={{ color: MUTED_TEXT }}>
                      Value
                    </Text>
                    <Text
                      className="mt-1 text-[20px] font-semibold"
                      style={{ color: CORAL }}
                      numberOfLines={1}
                    >
                      {formatCurrency(viewModel.position.totalValueUsd)}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Public / Shielded breakdown as paired tiles */}
              <View className="mt-3 flex-row gap-3">
                <StatTile
                  label="Public"
                  value={`${formatBalance(viewModel.position.publicBalance)} ${viewModel.token.symbol}`}
                />
                <StatTile
                  label="Shielded"
                  leadingIcon={
                    <ShieldCheck size={12} color={CORAL} strokeWidth={2} />
                  }
                  value={`${formatBalance(viewModel.position.shieldedBalance)} ${viewModel.token.symbol}`}
                />
              </View>

              {viewModel.position.shieldedBalance > 0 &&
              shieldedApyBps !== null &&
              shieldedApyBps > 0 ? (
                <ShieldedApyCallout
                  apyBps={shieldedApyBps}
                  tokenSymbol={viewModel.token.symbol}
                />
              ) : null}
            </>
          )}
        </SectionCard>

        <SectionCard title="Market">
          {marketRows.length > 0 ? (
            <View className="flex-row flex-wrap gap-3">
              {marketRows.map((row) => (
                <StatTile key={row.label} label={row.label} value={row.value} />
              ))}
            </View>
          ) : (
            <Text className="text-[14px]" style={{ color: MUTED_TEXT }}>
              Market stats unavailable right now.
            </Text>
          )}
          {!loading && !viewModel.market && error ? (
            <Text className="pt-3 text-[13px]" style={{ color: MUTED_TEXT }}>
              {error}
            </Text>
          ) : null}
        </SectionCard>

        {viewModel.info?.description ? (
          <AboutCard description={viewModel.info.description} />
        ) : null}

        <TrustCard info={viewModel.info} />

        {viewModel.info?.holderDistribution ? (
          <DistributionCard
            distribution={viewModel.info.holderDistribution}
            holderCount={viewModel.market?.holderCount ?? null}
          />
        ) : null}

        <LinksCard links={viewModel.links} />
      </View>
    </>
  );
}

export default function TokenDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { mint } = useLocalSearchParams<{ mint: string }>();
  const tokenMint = Array.isArray(mint) ? mint[0] : mint;

  const [isSendOpen, setIsSendOpen] = useState(false);
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);
  const [isSwapOpen, setIsSwapOpen] = useState(false);
  const [isShieldOpen, setIsShieldOpen] = useState(false);
  const [shieldDirection, setShieldDirection] =
    useState<ShieldDirection>("shield");
  const [activeChartPointIndex, setActiveChartPointIndex] = useState<number | null>(null);
  const [isChartInteracting, setIsChartInteracting] = useState(false);

  const { walletAddress } = useWalletInit();
  const { solBalanceLamports, refreshBalance } = useWalletBalance(walletAddress);
  const { solPriceUsd } = useSolPrice();
  const { tokenHoldings, refreshTokenHoldings } = useTokenHoldings(walletAddress);
  const apyByMint = useTokenApy(tokenHoldings);
  // Feed the same CoinGecko-backed token-detail cache the home screen uses,
  // so sheets launched from here (send/swap/shield) can resolve icons via
  // `detailLogoUrl` rather than falling back to Helius metadata or the
  // SOL-logo placeholder.
  const sheetTokenDetailMints = useMemo(
    () => Array.from(new Set(tokenHoldings.map((h) => h.mint))),
    [tokenHoldings],
  );
  const tokenDetailsByMint = useTokenDetails(sheetTokenDetailMints);
  const shieldedApyBps = tokenMint ? apyByMint[tokenMint] ?? null : null;

  const {
    viewModel,
    loading,
    error,
    reload,
  } = useTokenDetail({
    mint: tokenMint ?? "",
    holdings: tokenHoldings,
    transactions: [],
  });

  const handleRefreshWalletData = useCallback(async () => {
    await Promise.all([
      refreshBalance(true),
      refreshTokenHoldings(true),
      reload(),
    ]);
  }, [refreshBalance, refreshTokenHoldings, reload]);

  const handleSendComplete = useCallback(() => {
    void handleRefreshWalletData();
  }, [handleRefreshWalletData]);

  const handleSwapComplete = useCallback(() => {
    void handleRefreshWalletData();
  }, [handleRefreshWalletData]);

  const handleShieldComplete = useCallback(() => {
    void handleRefreshWalletData();
  }, [handleRefreshWalletData]);

  const handleChartInteractionChange = useCallback((isInteracting: boolean) => {
    setIsChartInteracting(isInteracting);
  }, []);

  const localHasData = viewModel.position.totalBalance > 0;
  const marketHasData = viewModel.market !== null || viewModel.chart.length > 0;
  const showUnavailable = !loading && !localHasData && !marketHasData;
  const showEmptyPosition = viewModel.position.totalBalance === 0;

  const spotPrice = resolveSpotPrice(
    tokenMint ?? "",
    tokenHoldings,
    viewModel.market?.priceUsd ?? null,
  );
  const activeChartPoint =
    activeChartPointIndex != null ? viewModel.chart[activeChartPointIndex] ?? null : null;
  const marketRows = buildMarketRows(viewModel.market);
  const initialSwapFromMint = viewModel.position.publicBalance > 0 ? viewModel.mint : undefined;
  const initialSwapToMint = viewModel.position.publicBalance > 0 ? undefined : viewModel.mint;

  const handleOpenShield = useCallback((direction: ShieldDirection) => {
    setShieldDirection(direction);
    setIsShieldOpen(true);
  }, []);

  const handleBackPress = useCallback(() => {
    router.back();
  }, [router]);

  if (!tokenMint) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-[18px] font-semibold text-black">Token unavailable</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <View
        className="z-10 bg-white px-4 pb-3"
        style={{
          borderBottomColor: "#f2f2f7",
          borderBottomWidth: 1,
          paddingTop: insets.top + 10,
        }}
      >
        <Pressable
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: "#f2f2ee" }}
          onPress={handleBackPress}
        >
          <ArrowLeft size={20} color="#111111" />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom + 32, 40),
          paddingTop: 8,
        }}
        scrollEnabled={!isChartInteracting}
      >
        <View className="px-4">
          <TokenDetailBody
            tokenMint={tokenMint}
            viewModel={viewModel}
            loading={loading}
            error={error}
            spotPrice={spotPrice}
            activeChartPoint={activeChartPoint}
            activeChartPointIndex={activeChartPointIndex}
            onActiveChartPointIndexChange={setActiveChartPointIndex}
            onChartInteractionChange={handleChartInteractionChange}
            showUnavailable={showUnavailable}
            showEmptyPosition={showEmptyPosition}
            marketRows={marketRows}
            shieldedApyBps={shieldedApyBps}
            onReceive={() => setIsReceiveOpen(true)}
            onReload={() => void reload()}
            onSend={() => setIsSendOpen(true)}
            onShield={() => handleOpenShield("shield")}
            onUnshield={() => handleOpenShield("unshield")}
            onSwap={() => setIsSwapOpen(true)}
          />
        </View>
      </ScrollView>

      <SendSheet
        open={isSendOpen}
        onClose={() => setIsSendOpen(false)}
        solBalanceLamports={solBalanceLamports}
        solPriceUsd={solPriceUsd}
        tokenHoldings={tokenHoldings}
        tokenDetailsByMint={tokenDetailsByMint}
        onSendComplete={handleSendComplete}
        initialMint={viewModel.mint}
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
        initialFromMint={initialSwapFromMint}
        initialToMint={initialSwapToMint}
      />

      <ShieldSheet
        open={isShieldOpen}
        onClose={() => setIsShieldOpen(false)}
        walletAddress={walletAddress}
        tokenHoldings={tokenHoldings}
        tokenDetailsByMint={tokenDetailsByMint}
        onShieldComplete={handleShieldComplete}
        initialMint={viewModel.mint}
        initialDirection={shieldDirection}
      />
    </View>
  );
}
