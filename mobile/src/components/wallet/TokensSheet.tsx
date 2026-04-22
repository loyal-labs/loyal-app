import {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { forwardRef, useCallback, useMemo } from "react";
import { Image as RNImage } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getDisplayTokenHoldings,
  getPairPositions,
  type PairPosition,
} from "@/lib/solana/token-holdings/display-holdings";
import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { Pressable, Text, View } from "@/tw";

type TokensSheetProps = {
  holdings: TokenHolding[];
  onTokenPress?: (mint: string) => void;
};

type TokenListItem = {
  holding: TokenHolding;
  position: PairPosition;
};

const PAIR_SURFACE = "#f6f6f8";
const PAIR_DIVIDER_COLOR = "#ededf0";
const PAIR_OUTER_RADIUS = 16;

function TokenRow({
  holding,
  onPress,
  groupPosition = "single",
}: {
  holding: TokenHolding;
  onPress?: () => void;
  groupPosition?: PairPosition;
}) {
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
  const isPaired = groupPosition !== "single";
  const isPairTop = groupPosition === "top";
  const isPairBottom = groupPosition === "bottom";

  return (
    <View style={{ paddingHorizontal: isPaired ? 12 : 0 }}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={{
          backgroundColor: isPaired ? PAIR_SURFACE : "transparent",
          borderTopLeftRadius: isPairTop ? PAIR_OUTER_RADIUS : 0,
          borderTopRightRadius: isPairTop ? PAIR_OUTER_RADIUS : 0,
          borderBottomLeftRadius: isPairBottom ? PAIR_OUTER_RADIUS : 0,
          borderBottomRightRadius: isPairBottom ? PAIR_OUTER_RADIUS : 0,
          borderTopWidth: isPairBottom ? 1 : 0,
          borderTopColor: PAIR_DIVIDER_COLOR,
        }}
      >
        <View
          className="flex-row items-center"
          style={{
            paddingHorizontal: isPaired ? 12 : 16,
            paddingTop: isPairBottom ? 8 : 10,
            paddingBottom: isPairTop ? 8 : 10,
          }}
        >
          <RNImage
            source={{ uri: icon }}
            style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "#f2f2f7" }}
          />
          <View className="ml-3 flex-1">
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
          <View className="items-end">
            <Text className="text-[17px] text-black">{balanceStr}</Text>
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
      </Pressable>
    </View>
  );
}

export const TokensSheet = forwardRef<BottomSheetModal, TokensSheetProps>(
  function TokensSheet({ holdings, onTokenPress }, ref) {
    const insets = useSafeAreaInsets();
    const snapPoints = useMemo(() => ["70%", "100%"], []);

    const renderBackdrop = useCallback(
      (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.3}
        />
      ),
      [],
    );

    const displayHoldings = useMemo(
      () => getDisplayTokenHoldings(holdings),
      [holdings],
    );

    const listData = useMemo<TokenListItem[]>(() => {
      const positions = getPairPositions(displayHoldings);
      return displayHoldings.map((holding, index) => ({
        holding,
        position: positions[index],
      }));
    }, [displayHoldings]);

    const renderItem = useCallback(
      ({ item }: { item: TokenListItem }) => (
        <TokenRow
          holding={item.holding}
          groupPosition={item.position}
          onPress={
            onTokenPress ? () => onTokenPress(item.holding.mint) : undefined
          }
        />
      ),
      [onTokenPress],
    );

    const keyExtractor = useCallback(
      (item: TokenListItem) =>
        `${item.holding.mint}-${item.holding.isSecured ? "s" : "r"}`,
      [],
    );

    return (
      <BottomSheetModal
        ref={ref}
        snapPoints={snapPoints}
        topInset={insets.top}
        enableDynamicSizing={false}
        backdropComponent={renderBackdrop}
      >
        <BottomSheetView className="px-4 pb-2">
          <Text
            className="text-[17px] font-semibold text-black"
            style={{ lineHeight: 22 }}
          >
            All Tokens
          </Text>
          <Text
            className="text-[13px]"
            style={{ color: "rgba(60, 60, 67, 0.6)" }}
          >
            {displayHoldings.length} token
            {displayHoldings.length !== 1 ? "s" : ""}
          </Text>
        </BottomSheetView>
        <BottomSheetFlatList
          data={listData}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      </BottomSheetModal>
    );
  },
);
