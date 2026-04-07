import { Image as RNImage } from "react-native";

import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { Pressable, Text, View } from "@/tw";

const shieldBadge = require("../../../assets/images/shield-badge.png");

type TokensListProps = {
  holdings: TokenHolding[];
  isLoading: boolean;
  maxItems?: number;
  onSeeAll?: () => void;
};

function TokenRow({ holding }: { holding: TokenHolding }) {
  const icon = resolveTokenIcon({ mint: holding.mint, imageUrl: holding.imageUrl });
  const valueStr = holding.valueUsd !== null
    ? `$${holding.valueUsd.toFixed(2)}`
    : "";
  const balanceStr = holding.balance > 0
    ? holding.balance < 0.0001
      ? "<0.0001"
      : holding.balance.toFixed(4)
    : "0";

  return (
    <View
      className="flex-row items-center rounded-[20px] px-4 py-2"
      style={{ borderWidth: 2, borderColor: "#f2f2f7" }}
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
        >
          {holding.symbol}
        </Text>
        <Text
          className="text-[15px]"
          style={{ color: "rgba(60, 60, 67, 0.6)" }}
        >
          {holding.name}
        </Text>
      </View>
      <View className="items-end pl-3">
        <Text
          className="text-[17px] text-black"
          style={{ letterSpacing: -0.187 }}
        >
          {balanceStr}
        </Text>
        {valueStr ? (
          <Text
            className="text-[15px]"
            style={{ color: "rgba(60, 60, 67, 0.6)" }}
          >
            {valueStr}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function TokensList({ holdings, isLoading, maxItems = 5, onSeeAll }: TokensListProps) {
  const displayHoldings = holdings
    .filter((h) => h.balance > 0)
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))
    .slice(0, maxItems);

  if (isLoading && displayHoldings.length === 0) {
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

  const totalCount = holdings.filter((h) => h.balance > 0).length;

  return (
    <View>
      <Text
        className="px-3 pb-2 pt-3 text-[16px] font-medium text-black"
        style={{ letterSpacing: -0.176 }}
      >
        Tokens
      </Text>
      <View className="gap-2 px-3">
        {displayHoldings.map((holding) => (
          <TokenRow key={`${holding.mint}-${holding.isSecured ? "s" : "r"}`} holding={holding} />
        ))}
      </View>
      {totalCount > maxItems && (
        <View className="mt-2 items-center px-3">
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
