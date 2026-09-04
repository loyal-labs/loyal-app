import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Brush, Copy, RefreshCcw } from "lucide-react-native";
import { useMemo, useState } from "react";
import { StyleSheet } from "react-native";

import {
  type BalanceBackgroundOption,
  findBalanceBackground,
} from "@/lib/wallet/balance-backgrounds";
import { formatAddress } from "@/lib/solana/wallet/formatters";
import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import { Pressable, Text, View } from "@/tw";
import { Image } from "@/tw/image";

type BalanceCardProps = {
  walletAddress: string | null;
  solBalanceLamports: number | null;
  totalPortfolioUsd?: number | null;
  isLoading: boolean;
  walletError?: string | null;
  onRetry?: () => void;
  showTopUpAction?: boolean;
  onTopUpPress?: () => void;
  /** id of the active balance background (null = no image). */
  balanceBg?: string | null;
  /** Hide brush button until preference has been hydrated. */
  bgLoaded?: boolean;
  onOpenBgPicker?: () => void;
};

export function BalanceCard({
  walletAddress,
  solBalanceLamports,
  totalPortfolioUsd,
  isLoading,
  walletError,
  onRetry,
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
  const [addressCopied, setAddressCopied] = useState(false);
  const solanaEnv = getSolanaEnv();

  const usdBalance =
    typeof totalPortfolioUsd === "number" && Number.isFinite(totalPortfolioUsd)
      ? totalPortfolioUsd
      : 0;

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

  const handleTopUp = () => {
    if (!onTopUpPress) return;
    if (process.env.EXPO_OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onTopUpPress();
  };

  const showSkeleton = isLoading || solBalanceLamports === null;

  // Headline balance — the full portfolio in USD (Figma 141:5879 shows no SOL,
  // and renders the cents smaller than the dollars on the same baseline).
  const formattedBalance = usdBalance.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const balanceDotIndex = formattedBalance.lastIndexOf(".");
  const balanceWhole = `$${
    balanceDotIndex >= 0
      ? formattedBalance.slice(0, balanceDotIndex)
      : formattedBalance
  }`;
  const balanceCents =
    balanceDotIndex >= 0 ? formattedBalance.slice(balanceDotIndex) : "";

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
                    <Text
                      style={[styles.balance, { color: primaryTextColor }]}
                      numberOfLines={1}
                    >
                      <Text style={styles.balanceWhole}>{balanceWhole}</Text>
                      <Text style={styles.balanceCents}>{balanceCents}</Text>
                    </Text>
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
  balance: {
    lineHeight: 48,
  },
  balanceWhole: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 40,
  },
  balanceCents: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 28,
  },
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
  topUpText: {
    color: "#fff",
    fontFamily: "Geist_600SemiBold",
    fontSize: 15,
    lineHeight: 18,
  },
});
