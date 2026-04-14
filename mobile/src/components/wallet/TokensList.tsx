import { useEffect, useMemo, useState } from "react";
import { Image as RNImage } from "react-native";

import { Pressable, Text, View } from "@/tw";
import { getDisplayTokenHoldings } from "@/lib/solana/token-holdings/display-holdings";
import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { fetchTokenDetailMarket } from "@/services/api";

import {
  buildTokenRowContent,
  type TokenRowMarketState,
} from "./tokens-list-row";
import { fetchTokenRowMarketState } from "./token-row-market";

const shieldBadge = require("../../../assets/images/shield-badge.png");
const MUTED_TEXT = "rgba(60, 60, 67, 0.6)";
const NEGATIVE_CHANGE = "#f97362";
const NEUTRAL_CHANGE = "#8e8e93";
const POSITIVE_CHANGE = "#24a148";

type TokensListProps = {
  holdings: TokenHolding[];
  isLoading: boolean;
  maxItems?: number;
  marketRefreshKey?: number;
  onSeeAll?: () => void;
  onTokenPress?: (mint: string) => void;
};

function TokenRow({
  holding,
  marketState,
  onPress,
}: {
  holding: TokenHolding;
  marketState: TokenRowMarketState;
  onPress?: () => void;
}) {
  const icon = resolveTokenIcon({ mint: holding.mint, imageUrl: holding.imageUrl });
  const rowContent = buildTokenRowContent(holding, marketState);
  const [pressed, setPressed] = useState(false);
  const priceChangeColor =
    rowContent.priceChangeTone === "positive"
      ? POSITIVE_CHANGE
      : rowContent.priceChangeTone === "negative"
        ? NEGATIVE_CHANGE
        : NEUTRAL_CHANGE;

  return (
    <Pressable
      className="rounded-[20px]"
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={!onPress}
    >
      <View
        className="flex-row items-center rounded-[20px] px-4 py-2"
        style={{
          borderWidth: 2,
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
              style={{ position: "absolute", bottom: 4, right: 10, width: 24, height: 24 }}
            />
          )}
        </View>
        <View className="flex-1 py-2.5">
          <Text
            className="text-[17px] font-medium text-black"
            style={{ letterSpacing: -0.187 }}
            numberOfLines={1}
          >
            {rowContent.title}
          </Text>
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
  isLoading,
  maxItems = 5,
  marketRefreshKey = 0,
  onSeeAll,
  onTokenPress,
}: TokensListProps) {
  const allDisplayHoldings = useMemo(
    () => getDisplayTokenHoldings(holdings),
    [holdings],
  );
  const displayHoldings = allDisplayHoldings.slice(0, maxItems);
  const [marketStates, setMarketStates] = useState<Record<string, TokenRowMarketState>>({});
  const displayMints = useMemo(
    () => Array.from(new Set(displayHoldings.map((holding) => holding.mint))),
    [displayHoldings],
  );

  useEffect(() => {
    setMarketStates({});
  }, [marketRefreshKey]);

  useEffect(() => {
    const missingMints = displayMints.filter((mint) => marketStates[mint] == null);

    if (missingMints.length === 0) {
      return;
    }

    setMarketStates((current) => {
      const next = { ...current };

      for (const mint of missingMints) {
        if (next[mint] == null) {
          next[mint] = { status: "loading" };
        }
      }

      return next;
    });

    void Promise.allSettled(
      missingMints.map(async (mint) => ({
        mint,
        marketState: await fetchTokenRowMarketState(mint, fetchTokenDetailMarket),
      })),
    ).then((results) => {
      setMarketStates((current) => {
        const next = { ...current };

        for (const [index, result] of results.entries()) {
          const mint = missingMints[index];

          if (result.status === "fulfilled") {
            next[result.value.mint] = result.value.marketState;
            continue;
          }

          next[mint] = { status: "error" };
        }

        return next;
      });
    });
  }, [displayMints, marketStates]);

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

  return (
    <View className="px-4">
      <Text
        className="pb-2 pt-3 text-[16px] font-medium text-black"
        style={{ letterSpacing: -0.176 }}
      >
        Tokens
      </Text>
      <View className="gap-2">
        {displayHoldings.map((holding) => (
          <TokenRow
            key={`${holding.mint}-${holding.isSecured ? "s" : "r"}`}
            holding={holding}
            marketState={marketStates[holding.mint] ?? { status: "loading" }}
            onPress={onTokenPress ? () => onTokenPress(holding.mint) : undefined}
          />
        ))}
      </View>
      {totalCount > maxItems && (
        <View className="mt-2 items-center">
          <Pressable
            className="flex-row items-center gap-1.5 rounded-full px-4 py-1.5"
            style={{ backgroundColor: "rgba(249, 54, 60, 0.14)" }}
            onPress={onSeeAll}
          >
            <Text className="text-[15px] text-black">
              Show All
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
