import { Image as RNImage } from "react-native";

import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { Pressable, Text, View } from "@/tw";

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
    <View className="flex-row items-center px-4 py-3">
      <RNImage
        source={{ uri: icon }}
        style={{ width: 40, height: 40, borderRadius: 20 }}
      />
      <View className="ml-3 flex-1">
        <Text className="text-sm font-medium text-black">{holding.symbol}</Text>
        <Text className="text-xs text-neutral-500">{holding.name}</Text>
      </View>
      <View className="items-end">
        <Text className="text-sm font-medium text-black">{balanceStr}</Text>
        {valueStr ? (
          <Text className="text-xs text-neutral-500">{valueStr}</Text>
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
        <Text className="text-center text-sm text-neutral-400">Loading tokens...</Text>
      </View>
    );
  }

  if (displayHoldings.length === 0) {
    return (
      <View className="px-4 py-6">
        <Text className="text-center text-sm text-neutral-400">No tokens found</Text>
      </View>
    );
  }

  return (
    <View>
      <Text className="mb-2 px-4 text-sm font-semibold text-neutral-700">
        Tokens
      </Text>
      {displayHoldings.map((holding) => (
        <TokenRow key={`${holding.mint}-${holding.isSecured ? "s" : "r"}`} holding={holding} />
      ))}
      {holdings.filter((h) => h.balance > 0).length > maxItems && (
        <Pressable className="px-4 py-2" onPress={onSeeAll}>
          <Text className="text-center text-sm font-medium text-blue-500">
            See all {holdings.filter((h) => h.balance > 0).length} tokens
          </Text>
        </Pressable>
      )}
    </View>
  );
}
