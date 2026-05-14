import { Zap } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Image as RNImage } from "react-native";

import type { TokenDetailsByMint } from "@/hooks/wallet/useTokenDetails";
import { derivePriceChange24hPercent } from "@/lib/solana/token-holdings/price-change";
import {
  getDisplayTokenHoldings,
  getPairPositions,
  type PairPosition,
} from "@/lib/solana/token-holdings/display-holdings";
import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import type { MobileTokenDetailResponse } from "@/services/api";
import { Pressable, Text, View } from "@/tw";

import {
  buildTokenRowContent,
  type TokenRowMarketState,
} from "./tokens-list-row";

const shieldBadge = require("../../../assets/images/shield-badge.png");
const MUTED_TEXT = "rgba(60, 60, 67, 0.6)";
const NEGATIVE_CHANGE = "#f97362";
const NEUTRAL_CHANGE = "#8e8e93";
const POSITIVE_CHANGE = "#24a148";
const APY_PILL_TEXT = "#2EA043";
const APY_PILL_BG = "rgba(52, 199, 89, 0.12)";

export function ApyPill({ apyBps }: { apyBps: number }) {
  const apyText = (apyBps / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    <View
      className="flex-row items-center rounded-full"
      style={{
        backgroundColor: APY_PILL_BG,
        paddingHorizontal: 6,
        paddingVertical: 2,
        gap: 3,
      }}
    >
      <Zap size={10} color={APY_PILL_TEXT} fill={APY_PILL_TEXT} strokeWidth={2.5} />
      <Text
        className="text-[11px] font-semibold"
        style={{ color: APY_PILL_TEXT, letterSpacing: -0.1, lineHeight: 14 }}
      >
        {apyText}% APY
      </Text>
    </View>
  );
}

type TokensListProps = {
  holdings: TokenHolding[];
  apyByMint?: Record<string, number>;
  tokenDetailsByMint: TokenDetailsByMint;
  isLoading: boolean;
  maxItems?: number;
  onSeeAll?: () => void;
  onTokenPress?: (mint: string) => void;
};

function deriveMarketState(
  detail: MobileTokenDetailResponse | undefined,
): TokenRowMarketState {
  if (!detail) return { status: "loading" };
  return {
    status: "loaded",
    priceUsd: detail.market.priceUsd,
    priceChange24hPercent: derivePriceChange24hPercent({
      explicitPriceChange24hPercent: detail.market.priceChange24hPercent,
      chart: detail.chart,
    }),
  };
}

const OUTER_RADIUS = 20;
const INNER_RADIUS = 0;

const radiiForPosition = (position: PairPosition) => {
  switch (position) {
    case "top":
      return {
        borderTopLeftRadius: OUTER_RADIUS,
        borderTopRightRadius: OUTER_RADIUS,
        borderBottomLeftRadius: INNER_RADIUS,
        borderBottomRightRadius: INNER_RADIUS,
      };
    case "bottom":
      return {
        borderTopLeftRadius: INNER_RADIUS,
        borderTopRightRadius: INNER_RADIUS,
        borderBottomLeftRadius: OUTER_RADIUS,
        borderBottomRightRadius: OUTER_RADIUS,
      };
    default:
      return {
        borderTopLeftRadius: OUTER_RADIUS,
        borderTopRightRadius: OUTER_RADIUS,
        borderBottomLeftRadius: OUTER_RADIUS,
        borderBottomRightRadius: OUTER_RADIUS,
      };
  }
};

function TokenRow({
  holding,
  detail,
  onPress,
  groupPosition = "single",
  apyBps,
}: {
  holding: TokenHolding;
  detail: MobileTokenDetailResponse | undefined;
  onPress?: () => void;
  groupPosition?: PairPosition;
  apyBps?: number;
}) {
  const icon = resolveTokenIcon({
    mint: holding.mint,
    imageUrl: holding.imageUrl,
    detailLogoUrl: detail?.token.logoUrl,
  });
  const marketState = deriveMarketState(detail);
  const rowContent = buildTokenRowContent(holding, marketState, {
    name: detail?.token.name,
    symbol: detail?.token.symbol,
  });
  const [pressed, setPressed] = useState(false);
  const priceChangeColor =
    rowContent.priceChangeTone === "positive"
      ? POSITIVE_CHANGE
      : rowContent.priceChangeTone === "negative"
        ? NEGATIVE_CHANGE
        : NEUTRAL_CHANGE;
  const radii = radiiForPosition(groupPosition);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={!onPress}
      style={radii}
    >
      <View
        className="flex-row items-center px-4 py-2"
        style={{
          ...radii,
          borderLeftWidth: 2,
          borderRightWidth: 2,
          borderTopWidth: groupPosition === "bottom" ? 0 : 2,
          borderBottomWidth: 2,
          borderColor: "#f2f2f7",
          backgroundColor: pressed ? "#f2f2f7" : "#ffffff",
        }}
      >
        <View className="py-1.5 pr-3" style={{ position: "relative" }}>
          <RNImage
            source={{ uri: icon }}
            style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "#f2f2f7" }}
          />
          {holding.isSecured && (
            <RNImage
              source={shieldBadge}
              style={{ position: "absolute", bottom: -2, right: 4, width: 24, height: 24 }}
            />
          )}
        </View>
        <View className="flex-1 py-2.5">
          <View className="flex-row items-center gap-1.5">
            <Text
              className="text-[17px] font-medium text-black"
              style={{ letterSpacing: -0.187, flexShrink: 1 }}
              numberOfLines={1}
            >
              {rowContent.title}
            </Text>
            {apyBps && apyBps > 0 ? <ApyPill apyBps={apyBps} /> : null}
          </View>
          {rowContent.showMarketSkeleton ? (
            <View className="mt-1 flex-row items-center gap-2">
              <View
                className="h-[15px] rounded-full"
                style={{ width: 68, backgroundColor: "#ededf0" }}
              />
              <View
                className="h-[15px] rounded-full"
                style={{ width: 54, backgroundColor: "#f2f2f7" }}
              />
            </View>
          ) : (
            <View className="mt-1 flex-row items-center gap-1.5">
              <Text
                className="text-[15px]"
                style={{ color: MUTED_TEXT }}
              >
                {rowContent.priceText}
              </Text>
              {rowContent.priceChangeText ? (
                <View
                  className="rounded-full px-2 py-0.5"
                  style={{ borderWidth: 1, borderColor: priceChangeColor }}
                >
                  <Text
                    className="text-[12px] font-medium"
                    style={{ color: priceChangeColor }}
                  >
                    {rowContent.priceChangeText}
                  </Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
        <View className="items-end pl-3">
          <Text
            className="text-[17px] font-medium text-black"
            style={{ letterSpacing: -0.187 }}
          >
            {rowContent.usdValue}
          </Text>
          <Text
            className="mt-1 text-[15px]"
            style={{ color: MUTED_TEXT }}
            numberOfLines={1}
          >
            {rowContent.balanceWithSymbol}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export function TokensList({
  holdings,
  apyByMint,
  tokenDetailsByMint,
  isLoading,
  maxItems = 5,
  onSeeAll,
  onTokenPress,
}: TokensListProps) {
  const resolveApy = (holding: TokenHolding): number | undefined =>
    holding.isSecured ? apyByMint?.[holding.mint] : undefined;
  const allDisplayHoldings = useMemo(
    () => getDisplayTokenHoldings(holdings),
    [holdings],
  );
  const displayHoldings = allDisplayHoldings.slice(0, maxItems);
  const pairPositions = useMemo(
    () => getPairPositions(displayHoldings),
    [displayHoldings],
  );
  const groups = useMemo(() => {
    const out: Array<
      | { kind: "single"; holding: TokenHolding }
      | { kind: "pair"; top: TokenHolding; bottom: TokenHolding }
    > = [];
    for (let i = 0; i < displayHoldings.length; i++) {
      const pos = pairPositions[i];
      if (pos === "top" && pairPositions[i + 1] === "bottom") {
        out.push({ kind: "pair", top: displayHoldings[i], bottom: displayHoldings[i + 1] });
        i += 1;
        continue;
      }
      out.push({ kind: "single", holding: displayHoldings[i] });
    }
    return out;
  }, [displayHoldings, pairPositions]);

  if (isLoading && holdings.length === 0) {
    return (
      <View className="px-4 py-6">
        <Text
          className="text-center text-[15px]"
          style={{ color: "rgba(60, 60, 67, 0.6)" }}
        >
          Loading tokens...
        </Text>
      </View>
    );
  }

  if (displayHoldings.length === 0) {
    return (
      <View className="px-4 py-6">
        <Text
          className="text-center text-[15px]"
          style={{ color: "rgba(60, 60, 67, 0.6)" }}
        >
          No tokens found
        </Text>
      </View>
    );
  }

  const totalCount = allDisplayHoldings.length;

  const showSeeAll = totalCount > maxItems;

  return (
    <View className="px-4">
      <View style={{ position: "relative" }}>
        <Text
          className="pb-2 pt-3 text-[16px] font-medium text-black"
          style={{ letterSpacing: -0.176 }}
        >
          Tokens
        </Text>
        {showSeeAll ? (
          <Pressable
            onPress={onSeeAll}
            hitSlop={8}
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              justifyContent: "center",
            }}
          >
            {({ pressed }) => (
              <Text
                className="text-[16px]"
                style={{ color: "#F9363C", opacity: pressed ? 0.7 : 1 }}
              >
                See All
              </Text>
            )}
          </Pressable>
        ) : null}
      </View>
      <View className="gap-2">
        {groups.map((group) => {
          if (group.kind === "single") {
            const h = group.holding;
            return (
              <TokenRow
                key={`${h.mint}-${h.isSecured ? "s" : "r"}`}
                holding={h}
                detail={tokenDetailsByMint[h.mint]}
                onPress={onTokenPress ? () => onTokenPress(h.mint) : undefined}
                groupPosition="single"
                apyBps={resolveApy(h)}
              />
            );
          }

          const topKey = `${group.top.mint}-${group.top.isSecured ? "s" : "r"}`;
          const bottomKey = `${group.bottom.mint}-${group.bottom.isSecured ? "s" : "r"}`;
          return (
            <View key={`pair-${topKey}`}>
              <TokenRow
                holding={group.top}
                detail={tokenDetailsByMint[group.top.mint]}
                onPress={
                  onTokenPress ? () => onTokenPress(group.top.mint) : undefined
                }
                groupPosition="top"
                apyBps={resolveApy(group.top)}
              />
              <TokenRow
                key={bottomKey}
                holding={group.bottom}
                detail={tokenDetailsByMint[group.bottom.mint]}
                onPress={
                  onTokenPress
                    ? () => onTokenPress(group.bottom.mint)
                    : undefined
                }
                groupPosition="bottom"
                apyBps={resolveApy(group.bottom)}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}
