import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Brush, Copy, RefreshCcw } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet } from "react-native";

import {
  type BalanceBackgroundOption,
  findBalanceBackground,
} from "@/lib/wallet/balance-backgrounds";
import type { KaminoUsdcEarnings } from "@/lib/solana/deposits/kamino-earnings";
import { formatAddress } from "@/lib/solana/wallet/formatters";
import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import { Pressable, Text, View } from "@/tw";
import { Image } from "@/tw/image";

type BalanceCardProps = {
  walletAddress: string | null;
  solBalanceLamports: number | null;
  solPriceUsd: number | null;
  totalPortfolioUsd?: number | null;
  displayCurrency: "USD" | "SOL";
  onToggleCurrency: () => void;
  isLoading: boolean;
  walletError?: string | null;
  onRetry?: () => void;
  /** Aggregate Kamino USDC earnings pill. Hidden when null or zero. */
  earnings?: KaminoUsdcEarnings | null;
  showTopUpAction?: boolean;
  onTopUpPress?: () => void;
  /** id of the active balance background (null = no image). */
  balanceBg?: string | null;
  /** Hide brush button until preference has been hydrated. */
  bgLoaded?: boolean;
  onOpenBgPicker?: () => void;
};

function formatEarnedPct(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function formatEarnedUsd(usd: number): string {
  return `$${usd.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function BalanceCard({
  walletAddress,
  solBalanceLamports,
  solPriceUsd,
  totalPortfolioUsd,
  displayCurrency,
  onToggleCurrency,
  isLoading,
  walletError,
  onRetry,
  earnings,
  showTopUpAction = false,
  onTopUpPress,
  balanceBg,
  bgLoaded = true,
  onOpenBgPicker,
}: BalanceCardProps) {
  const activeBg: BalanceBackgroundOption | undefined = useMemo(
    () => findBalanceBackground(balanceBg ?? null),
    [balanceBg],
  );
  const bgSource = activeBg?.source ?? null;
  const hasBg = bgSource !== null;
  const primaryTextColor = hasBg ? "#ffffff" : "#1c1c1e";
  const mutedTextColor = hasBg
    ? "rgba(255, 255, 255, 0.7)"
    : "rgba(60, 60, 67, 0.6)";

  const handleOpenBgPicker = () => {
    if (!onOpenBgPicker) return;
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onOpenBgPicker();
  };
  const showEarningsPill =
    !!earnings && earnings.earnedUsd > 0 && earnings.earnedPct > 0;
  const [addressCopied, setAddressCopied] = useState(false);
  const solanaEnv = getSolanaEnv();

  const solBalance =
    solBalanceLamports !== null ? solBalanceLamports / LAMPORTS_PER_SOL : 0;
  const solOnlyUsdBalance = solPriceUsd !== null ? solBalance * solPriceUsd : 0;
  const usdBalance =
    typeof totalPortfolioUsd === "number" && Number.isFinite(totalPortfolioUsd)
      ? totalPortfolioUsd
      : solOnlyUsdBalance;
  const solEquivalentBalance =
    solPriceUsd !== null && solPriceUsd > 0 ? usdBalance / solPriceUsd : solBalance;

  const handleCopyAddress = async () => {
    if (!walletAddress) return;
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    await Clipboard.setStringAsync(walletAddress);
    setAddressCopied(true);
    if (process.env.EXPO_OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setTimeout(() => setAddressCopied(false), 2000);
  };

  const handleToggle = () => {
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onToggleCurrency();
  };

  const handleTopUp = () => {
    if (!onTopUpPress) return;
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onTopUpPress();
  };

  const showSkeleton = isLoading || solBalanceLamports === null;

  // Format the primary balance display
  const formatPrimary = () => {
    if (displayCurrency === "USD") {
      return `$${usdBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `${solEquivalentBalance.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} SOL`;
  };

  // Format the secondary balance display
  const formatSecondary = () => {
    if (displayCurrency === "USD") {
      return `${solEquivalentBalance.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} SOL`;
    }
    return `$${usdBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <View className="mt-5 px-4">
      <View
        className="self-stretch overflow-hidden rounded-[26px]"
        style={{
          borderWidth: 2,
          borderColor: "rgba(255, 255, 255, 0.1)",
          aspectRatio: 361 / 203,
        }}
      >
        <View
          className="absolute inset-0"
          style={{ backgroundColor: "#f2f2f7" }}
        />
        {bgSource ? (
          <Image
            source={bgSource}
            style={styles.bgImage}
            contentFit="cover"
            transition={120}
          />
        ) : null}
        <View
          className="absolute inset-0"
          style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
        />

        {walletError ? (
          <View className="h-full items-center justify-center gap-3 px-4">
            <Text className="px-4 text-center text-[15px] leading-5 text-white">
              {walletError}
            </Text>
            {onRetry && (
              <Pressable
                onPress={onRetry}
                className="flex-row items-center gap-1.5 rounded-full bg-white/20 px-4 py-2"
              >
                <RefreshCcw size={16} strokeWidth={2} color="white" />
                <Text className="text-[15px] font-medium text-white">Retry</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View className="h-full justify-between p-4">
            {/* Wallet address */}
            <View className="gap-0.5">
              {isLoading || !walletAddress ? (
                <>
                  <View className="h-5 w-28 rounded bg-white/20" />
                  <View className="mt-1 h-4 w-20 rounded bg-white/15" />
                </>
              ) : (
                <>
                  <Pressable
                    onPress={handleCopyAddress}
                    className="flex-row items-center gap-1 self-start"
                  >
                    <Copy size={16} strokeWidth={1.5} color={mutedTextColor} />
                    <Text
                      className="text-[17px]"
                      style={{ lineHeight: 22, color: primaryTextColor }}
                    >
                      {addressCopied ? "Copied!" : formatAddress(walletAddress)}
                    </Text>
                  </Pressable>
                  <Text
                    className="ml-0.5 text-[13px] capitalize"
                    style={{ lineHeight: 18, color: mutedTextColor }}
                  >
                    Solana {solanaEnv}
                  </Text>
                </>
              )}
            </View>

            {/* Balance */}
            <View className="gap-1">
              {showSkeleton ? (
                <View className="gap-2">
                  <View className="h-10 w-40 rounded bg-white/20" />
                  <View className="h-5 w-28 rounded bg-white/10" />
                </View>
              ) : (
                <View className="self-start">
                  <View className="flex-row items-center gap-3">
                    <Pressable onPress={handleToggle}>
                      <Text
                        className="text-[40px] font-semibold leading-[48px]"
                        style={{ color: primaryTextColor }}
                      >
                        {formatPrimary()}
                      </Text>
                    </Pressable>
                    {showTopUpAction && onTopUpPress ? (
                      <Pressable
                        onPress={handleTopUp}
                        className="rounded-full px-4 py-2"
                        style={{
                          backgroundColor: hasBg
                            ? "rgba(255,255,255,0.2)"
                            : "rgba(60, 60, 67, 0.12)",
                        }}
                      >
                        <Text
                          style={[
                            styles.topUpText,
                            { color: hasBg ? "#fff" : "#1c1c1e" },
                          ]}
                        >
                          Top up
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {showEarningsPill && earnings && (
                    <View style={styles.earningsRow}>
                      <View style={styles.earningsPill}>
                        <Text style={styles.earningsPillText}>
                          {formatEarnedPct(earnings.earnedPct)} (
                          {formatEarnedUsd(earnings.earnedUsd)})
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.earningsAllTime,
                          { color: mutedTextColor },
                        ]}
                      >
                        All time
                      </Text>
                    </View>
                  )}
                  <Text
                    className="mt-1 text-[17px]"
                    style={{ lineHeight: 22, color: mutedTextColor }}
                  >
                    {solPriceUsd !== null ? formatSecondary() : (
                      <ActivityIndicator
                        size="small"
                        color={hasBg ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)"}
                      />
                    )}
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {bgLoaded && onOpenBgPicker ? (
          <Pressable
            onPress={handleOpenBgPicker}
            style={[
              styles.bgPickerBtn,
              {
                backgroundColor: hasBg
                  ? "rgba(255, 255, 255, 0.18)"
                  : "rgba(0, 0, 0, 0.06)",
              },
            ]}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Change balance background"
          >
            <Brush
              size={18}
              strokeWidth={1.5}
              color={
                hasBg
                  ? "rgba(255, 255, 255, 0.85)"
                  : "rgba(60, 60, 67, 0.7)"
              }
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bgImage: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 26,
  },
  bgPickerBtn: {
    position: "absolute",
    bottom: 12,
    right: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  earningsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  earningsPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.92)",
  },
  earningsPillText: {
    color: "#15803d",
    fontFamily: "Geist_600SemiBold",
    fontSize: 13,
    lineHeight: 18,
  },
  earningsAllTime: {
    fontFamily: "Geist_500Medium",
    fontSize: 13,
    lineHeight: 18,
  },
  topUpText: {
    color: "#fff",
    fontFamily: "Geist_600SemiBold",
    fontSize: 15,
    lineHeight: 18,
  },
});
