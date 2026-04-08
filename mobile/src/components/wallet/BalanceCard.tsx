import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Copy, RefreshCcw } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, StyleSheet } from "react-native";

import { formatAddress } from "@/lib/solana/wallet/formatters";
import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import { Pressable, Text, View } from "@/tw";
import { Image } from "@/tw/image";

const DEFAULT_BALANCE_BG = require("../../../assets/images/balance-bg-default.png");

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
};

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
}: BalanceCardProps) {
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
        <Image
          source={DEFAULT_BALANCE_BG}
          style={styles.bgImage}
          contentFit="cover"
          transition={120}
        />
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
                    <Copy size={16} strokeWidth={1.5} color="rgba(255,255,255,0.7)" />
                    <Text
                      className="text-[17px] text-white/80"
                      style={{ lineHeight: 22 }}
                    >
                      {addressCopied ? "Copied!" : formatAddress(walletAddress)}
                    </Text>
                  </Pressable>
                  <Text
                    className="ml-0.5 text-[13px] capitalize text-white/70"
                    style={{ lineHeight: 18 }}
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
                <Pressable onPress={handleToggle} className="self-start">
                  <Text className="text-[40px] font-semibold leading-[48px] text-white">
                    {formatPrimary()}
                  </Text>
                  <Text
                    className="mt-1 text-[17px] text-white/60"
                    style={{ lineHeight: 22 }}
                  >
                    {solPriceUsd !== null ? formatSecondary() : (
                      <ActivityIndicator size="small" color="rgba(255,255,255,0.4)" />
                    )}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bgImage: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 26,
  },
});
