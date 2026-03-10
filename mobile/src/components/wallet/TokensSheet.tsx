import {
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { forwardRef, useCallback, useMemo } from "react";
import { Image as RNImage } from "react-native";

import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { Text, View } from "@/tw";

type TokensSheetProps = {
  holdings: TokenHolding[];
};

function TokenRow({ holding }: { holding: TokenHolding }) {
  const icon = resolveTokenIcon({
    mint: holding.mint,
    imageUrl: holding.imageUrl,
  });
  const valueStr =
    holding.valueUsd !== null ? `$${holding.valueUsd.toFixed(2)}` : "";
  const balanceStr =
    holding.balance > 0
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
        <Text className="text-sm font-medium text-black">
          {holding.symbol}
        </Text>
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

export const TokensSheet = forwardRef<BottomSheetModal, TokensSheetProps>(
  function TokensSheet({ holdings }, ref) {
    const snapPoints = useMemo(() => ["70%", "90%"], []);

    const displayHoldings = useMemo(
      () =>
        holdings
          .filter((h) => h.balance > 0)
          .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)),
      [holdings],
    );

    const renderItem = useCallback(
      ({ item }: { item: TokenHolding }) => <TokenRow holding={item} />,
      [],
    );

    const keyExtractor = useCallback(
      (item: TokenHolding) =>
        `${item.mint}-${item.isSecured ? "s" : "r"}`,
      [],
    );

    return (
      <BottomSheetModal
        ref={ref}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
      >
        <BottomSheetView className="px-4 pb-2">
          <Text className="text-lg font-semibold text-black">All Tokens</Text>
          <Text className="text-xs text-neutral-500">
            {displayHoldings.length} token
            {displayHoldings.length !== 1 ? "s" : ""}
          </Text>
        </BottomSheetView>
        <BottomSheetFlatList
          data={displayHoldings}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      </BottomSheetModal>
    );
  },
);
