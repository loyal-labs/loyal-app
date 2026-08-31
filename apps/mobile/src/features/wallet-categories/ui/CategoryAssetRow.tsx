import { Image as RNImage } from "react-native";

import {
  buildTokenRowContent,
  type TokenRowMarketState,
} from "@/components/wallet/tokens-list-row";
import { derivePriceChange24hPercent } from "@/lib/solana/token-holdings/price-change";
import type { PairPosition } from "@/lib/solana/token-holdings/display-holdings";
import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import type { MobileTokenDetailResponse } from "@/services/api";
import { Pressable, Text, View } from "@/tw";

import type { WalletCategory } from "../model/categorize";

const MUTED = "rgba(60, 60, 67, 0.6)";
const POSITIVE = "#24a148";
const NEGATIVE = "#f97362";
const NEUTRAL = "#8e8e93";

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

export function CategoryAssetRow({
  holding,
  detail,
  variant,
  groupPosition = "single",
  onPress,
}: {
  holding: TokenHolding;
  detail: MobileTokenDetailResponse | undefined;
  variant: WalletCategory;
  groupPosition?: PairPosition;
  onPress?: () => void;
}) {
  const icon = resolveTokenIcon({
    mint: holding.mint,
    imageUrl: holding.imageUrl,
    detailLogoUrl: detail?.token.logoUrl,
  });
  const content = buildTokenRowContent(holding, deriveMarketState(detail), {
    name: detail?.token.name,
    symbol: detail?.token.symbol,
  });
  const changeColor =
    content.priceChangeTone === "positive"
      ? POSITIVE
      : content.priceChangeTone === "negative"
        ? NEGATIVE
        : NEUTRAL;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className="flex-row items-center px-4"
    >
      <View className="py-1.5 pr-3" style={{ position: "relative" }}>
        <RNImage
          source={{ uri: icon }}
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: "#f2f2f7",
            borderWidth: 0.5,
            borderColor: "rgba(0, 0, 0, 0.08)",
          }}
        />
        {groupPosition === "top" ? (
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
          numberOfLines={1}
        >
          {content.title}
        </Text>
        {variant === "crypto" ? (
          <View className="mt-0.5 flex-row items-center gap-1.5">
            <Text className="text-[15px]" style={{ color: MUTED, lineHeight: 20 }}>
              {content.priceText}
            </Text>
            {content.priceChangeText ? (
              <Text
                className="text-[15px] font-medium"
                style={{ color: changeColor, lineHeight: 20 }}
              >
                {content.priceChangeText}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text
            className="mt-0.5 text-[15px]"
            style={{ color: MUTED, lineHeight: 20 }}
            numberOfLines={1}
          >
            {content.balanceWithSymbol}
          </Text>
        )}
      </View>

      <View className="items-end pl-3">
        <Text
          className="text-[17px] font-medium text-black"
          style={{ letterSpacing: -0.187, lineHeight: 22 }}
        >
          {content.usdValue}
        </Text>
        {variant === "crypto" ? (
          <Text
            className="mt-0.5 text-[15px]"
            style={{ color: MUTED, lineHeight: 20 }}
            numberOfLines={1}
          >
            {content.balanceWithSymbol}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
