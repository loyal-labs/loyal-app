import {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  BottomSheetModal,
} from "@gorhom/bottom-sheet";
import { forwardRef, useCallback, useMemo } from "react";
import { Image as RNImage } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { TokenDetailsByMint } from "@/hooks/wallet/useTokenDetails";
import {
  getDisplayTokenHoldings,
  getPairPositions,
  type PairPosition,
} from "@/lib/solana/token-holdings/display-holdings";
import {
  resolveTokenIcon,
  resolveTokenName,
  resolveTokenSymbol,
} from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import type { MobileTokenDetailResponse } from "@/services/api";
import { Pressable, Text, View } from "@/tw";

import { ApyPill } from "./TokensList";

const shieldBadge = require("../../../assets/images/shield-badge.png");

type TokensSheetProps = {
  holdings: TokenHolding[];
  apyByMint?: Record<string, number>;
  tokenDetailsByMint: TokenDetailsByMint;
  onTokenPress?: (mint: string) => void;
};

type TokenListItem = {
  holding: TokenHolding;
  detail: MobileTokenDetailResponse | undefined;
  position: PairPosition;
  apyBps?: number;
};

const PAIR_SURFACE = "#f6f6f8";
const PAIR_DIVIDER_COLOR = "#ededf0";
const PAIR_OUTER_RADIUS = 16;

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
  const symbol = resolveTokenSymbol({
    mint: holding.mint,
    detailSymbol: detail?.token.symbol,
    holdingSymbol: holding.symbol,
  });
  const name = resolveTokenName({
    mint: holding.mint,
    detailName: detail?.token.name,
    holdingName: holding.name,
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
          <View style={{ position: "relative" }}>
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
          <View className="ml-3 flex-1">
            <View className="flex-row items-center gap-1.5">
              <Text
                className="text-[17px] font-medium text-black"
                style={{ letterSpacing: -0.187, flexShrink: 1 }}
                numberOfLines={1}
              >
                {symbol}
              </Text>
              {apyBps && apyBps > 0 ? <ApyPill apyBps={apyBps} /> : null}
            </View>
            <Text
              className="text-[15px]"
              style={{ color: "rgba(60, 60, 67, 0.6)" }}
            >
              {name}
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
  function TokensSheet(
    { holdings, apyByMint, tokenDetailsByMint, onTokenPress },
    ref,
  ) {
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
        detail: tokenDetailsByMint[holding.mint],
        position: positions[index],
        apyBps: holding.isSecured ? apyByMint?.[holding.mint] : undefined,
      }));
    }, [displayHoldings, apyByMint, tokenDetailsByMint]);

    const renderItem = useCallback(
      ({ item }: { item: TokenListItem }) => (
        <TokenRow
          holding={item.holding}
          detail={item.detail}
          groupPosition={item.position}
          apyBps={item.apyBps}
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

    const listHeader = useMemo(
      () => (
        <View className="px-4 pb-2 pt-1">
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
        </View>
      ),
      [displayHoldings.length],
    );

    return (
      <BottomSheetModal
        ref={ref}
        snapPoints={snapPoints}
        topInset={insets.top}
        enableDynamicSizing={false}
        backdropComponent={renderBackdrop}
      >
        <BottomSheetFlatList
          data={listData}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          ListHeaderComponent={listHeader}
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      </BottomSheetModal>
    );
  },
);
