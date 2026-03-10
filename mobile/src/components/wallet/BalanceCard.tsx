import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Copy, RefreshCcw } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator } from "react-native";

import { formatAddress } from "@/lib/solana/wallet/formatters";
import { Pressable, Text, View } from "@/tw";

type BalanceCardProps = {
  walletAddress: string | null;
  solBalanceLamports: number | null;
  solPriceUsd: number | null;
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
  displayCurrency,
  onToggleCurrency,
  isLoading,
  walletError,
  onRetry,
}: BalanceCardProps) {
  const [addressCopied, setAddressCopied] = useState(false);

  const solBalance =
    solBalanceLamports !== null ? solBalanceLamports / LAMPORTS_PER_SOL : 0;
  const usdBalance = solPriceUsd !== null ? solBalance * solPriceUsd : 0;

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
    return `${solBalance.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} SOL`;
  };

  // Format the secondary balance display
  const formatSecondary = () => {
    if (displayCurrency === "USD") {
      return `${solBalance.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} SOL`;
    }
    return `$${usdBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <View className="mx-4 mt-5 overflow-hidden rounded-3xl bg-black p-5">
      {walletError ? (
        <View className="items-center justify-center gap-3 py-6">
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
        <View className="gap-4">
          {/* Wallet address */}
          <View className="gap-0.5">
            {isLoading || !walletAddress ? (
              <View className="h-5 w-28 rounded bg-white/20" />
            ) : (
              <Pressable
                onPress={handleCopyAddress}
                className="flex-row items-center gap-1 self-start"
              >
                <Copy size={16} strokeWidth={1.5} color="rgba(255,255,255,0.6)" />
                <Text className="text-[15px] text-white/60">
                  {addressCopied ? "Copied!" : formatAddress(walletAddress)}
                </Text>
              </Pressable>
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
                <Text className="mt-1 text-[17px] text-white/60">
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
  );
}
