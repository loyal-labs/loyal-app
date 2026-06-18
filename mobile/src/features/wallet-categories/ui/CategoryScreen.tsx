import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { ArrowDown, ArrowLeft, ArrowUp, MoreHorizontal } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ReceiveSheet } from "@/components/wallet/ReceiveSheet";
import { SendSheet } from "@/components/wallet/SendSheet";
import { ShieldSheet } from "@/components/wallet/ShieldSheet";
import { SwapSheet } from "@/components/wallet/SwapSheet";
import { buildTokenDetailHref } from "@/features/token-details/routes";
import { useSolPrice } from "@/hooks/wallet/useSolPrice";
import { useTokenDetails } from "@/hooks/wallet/useTokenDetails";
import { useTokenHoldings } from "@/hooks/wallet/useTokenHoldings";
import { useWalletBalance } from "@/hooks/wallet/useWalletBalance";
import { useWalletInit } from "@/hooks/wallet/useWalletInit";
import {
  LOYAL_TOKEN_MINT,
  NATIVE_SOL_MINT,
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDC_MINT_MAINNET,
} from "@/lib/solana/constants";
import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import type { ShieldDirection } from "@/lib/solana/shielding";
import {
  getDisplayTokenHoldings,
  getPairPositions,
} from "@/lib/solana/token-holdings/display-holdings";
import { Pressable, ScrollView, Text, View } from "@/tw";

import {
  filterHoldingsByCategory,
  sumHoldingsUsd,
  type WalletCategory,
} from "../model/categorize";
import { splitUsd } from "../model/format";
import { CategoryAssetRow } from "./CategoryAssetRow";
import { CryptoGlyph, StablecoinsGlyph } from "./CategoryGlyphs";
import { MoreActionsSheet } from "./MoreActionsSheet";

const MUTED = "rgba(60, 60, 67, 0.6)";
const CENTS_DIM = "rgba(60, 60, 67, 0.4)";

function BottomButton({
  icon,
  label,
  onPress,
  variant,
}: {
  icon: ReactNode;
  label?: string;
  onPress: () => void;
  variant: "primary" | "secondary";
}) {
  const [pressed, setPressed] = useState(false);
  const isPrimary = variant === "primary";
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-[50px] flex-row items-center justify-center gap-1"
      style={{
        flex: label ? 1 : undefined,
        width: label ? undefined : 50,
        borderRadius: 78,
        backgroundColor: isPrimary ? "#000000" : "#f5f5f5",
        opacity: pressed ? 0.85 : 1,
      }}
    >
      {icon}
      {label ? (
        <Text
          className="text-[17px] font-medium"
          style={{ color: isPrimary ? "#FFFFFF" : "#000000", lineHeight: 22 }}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function CategoryScreen({ category }: { category: WalletCategory }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { walletAddress } = useWalletInit();
  const { solBalanceLamports, refreshBalance } = useWalletBalance(walletAddress);
  const { solPriceUsd } = useSolPrice();
  const { tokenHoldings, isHoldingsLoading, refreshTokenHoldings } =
    useTokenHoldings(walletAddress);

  const tokenDetailMints = useMemo(() => {
    const mints = new Set<string>([
      NATIVE_SOL_MINT,
      LOYAL_TOKEN_MINT,
      getSolanaEnv() === "mainnet"
        ? SOLANA_USDC_MINT_MAINNET
        : SOLANA_USDC_MINT_DEVNET,
    ]);
    for (const holding of tokenHoldings) mints.add(holding.mint);
    return Array.from(mints);
  }, [tokenHoldings]);
  const tokenDetailsByMint = useTokenDetails(tokenDetailMints);

  // Reuse the wallet list's sort + pair grouping, then keep only this
  // category's holdings (pairs stay adjacent, so connectors still line up).
  const displayHoldings = useMemo(
    () => filterHoldingsByCategory(getDisplayTokenHoldings(tokenHoldings), category),
    [tokenHoldings, category],
  );
  const pairPositions = useMemo(
    () => getPairPositions(displayHoldings),
    [displayHoldings],
  );
  const totalUsd = useMemo(
    () => sumHoldingsUsd(displayHoldings),
    [displayHoldings],
  );
  const balance = splitUsd(totalUsd);

  const [isSendOpen, setIsSendOpen] = useState(false);
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);
  const [isSwapOpen, setIsSwapOpen] = useState(false);
  const [isShieldOpen, setIsShieldOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [shieldDirection, setShieldDirection] =
    useState<ShieldDirection>("shield");

  const refresh = useCallback(() => {
    void refreshBalance(true);
    void refreshTokenHoldings(true);
  }, [refreshBalance, refreshTokenHoldings]);

  const handleOpenShield = useCallback((direction: ShieldDirection) => {
    setShieldDirection(direction);
    setIsShieldOpen(true);
  }, []);

  const handleTokenPress = useCallback(
    (mint: string) => {
      if (process.env.EXPO_OS !== "web") {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      router.push(buildTokenDetailHref(mint));
    },
    [router],
  );

  const title = category === "stablecoins" ? "Stablecoins" : "Crypto";
  const glyph =
    category === "stablecoins" ? (
      <StablecoinsGlyph size={64} />
    ) : (
      <CryptoGlyph size={64} />
    );
  const initialMint = displayHoldings[0]?.mint;

  return (
    <View className="flex-1 bg-white">
      <View
        className="flex-row items-center px-4 pb-2"
        style={{ paddingTop: insets.top + 8 }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: "#f2f2f7" }}
          hitSlop={8}
        >
          <ArrowLeft size={24} color="#1C1C1E" strokeWidth={2} />
        </Pressable>
        <Text
          className="ml-3 flex-1 text-[22px] font-semibold text-black"
          style={{ letterSpacing: -0.44, lineHeight: 28 }}
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 16 }}
      >
        <View className="flex-row items-center px-4 py-2">
          <View className="py-2 pr-3">{glyph}</View>
          <View className="flex-1">
            <Text className="text-[14px]" style={{ color: MUTED, lineHeight: 20 }}>
              Balance
            </Text>
            <Text
              className="text-[40px] font-semibold text-black"
              style={{ letterSpacing: -0.44, lineHeight: 48 }}
            >
              {balance.whole}
              <Text style={{ color: CENTS_DIM }}>{balance.cents}</Text>
            </Text>
          </View>
        </View>

        <View className="px-4 pb-2 pt-3">
          <Text
            className="text-[17px] font-semibold text-black"
            style={{ letterSpacing: -0.187, lineHeight: 22 }}
          >
            Assets
          </Text>
        </View>

        {displayHoldings.length === 0 ? (
          <View className="px-4 py-6">
            <Text
              className="text-center text-[15px]"
              style={{ color: MUTED }}
            >
              {isHoldingsLoading ? "Loading assets…" : "No assets yet"}
            </Text>
          </View>
        ) : (
          displayHoldings.map((holding, index) => (
            <CategoryAssetRow
              key={`${holding.mint}-${holding.isSecured ? "s" : "r"}`}
              holding={holding}
              detail={tokenDetailsByMint[holding.mint]}
              variant={category}
              groupPosition={pairPositions[index]}
              onPress={() => handleTokenPress(holding.mint)}
            />
          ))
        )}
      </ScrollView>

      <View
        className="flex-row items-center gap-2 px-4 pt-2"
        style={{ paddingBottom: insets.bottom + 8 }}
      >
        <BottomButton
          variant="primary"
          label="Send"
          icon={<ArrowUp size={24} color="#FFFFFF" strokeWidth={2} />}
          onPress={() => {
            void Haptics.selectionAsync();
            setIsSendOpen(true);
          }}
        />
        <BottomButton
          variant="secondary"
          label="Receive"
          icon={<ArrowDown size={24} color="#000000" strokeWidth={2} />}
          onPress={() => {
            void Haptics.selectionAsync();
            setIsReceiveOpen(true);
          }}
        />
        <BottomButton
          variant="secondary"
          icon={<MoreHorizontal size={24} color="#000000" strokeWidth={2} />}
          onPress={() => {
            void Haptics.selectionAsync();
            setIsMoreOpen(true);
          }}
        />
      </View>

      <SendSheet
        open={isSendOpen}
        onClose={() => setIsSendOpen(false)}
        solBalanceLamports={solBalanceLamports}
        solPriceUsd={solPriceUsd}
        tokenHoldings={tokenHoldings}
        tokenDetailsByMint={tokenDetailsByMint}
        onSendComplete={refresh}
        initialMint={initialMint}
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
        onSwapComplete={refresh}
        initialFromMint={initialMint}
      />

      <ShieldSheet
        open={isShieldOpen}
        onClose={() => setIsShieldOpen(false)}
        walletAddress={walletAddress}
        tokenHoldings={tokenHoldings}
        tokenDetailsByMint={tokenDetailsByMint}
        onShieldComplete={refresh}
        initialMint={initialMint}
        initialDirection={shieldDirection}
      />

      <MoreActionsSheet
        open={isMoreOpen}
        onClose={() => setIsMoreOpen(false)}
        onSwap={() => setIsSwapOpen(true)}
        onShield={() => handleOpenShield("shield")}
        onUnshield={() => handleOpenShield("unshield")}
      />
    </View>
  );
}
