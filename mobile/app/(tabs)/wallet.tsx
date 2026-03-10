import { ArrowDown, ArrowLeftRight, ArrowUp } from "lucide-react-native";
import { useCallback } from "react";
import { ActivityIndicator, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ActionButton } from "@/components/wallet/ActionButton";
import { BalanceCard } from "@/components/wallet/BalanceCard";
import { useDisplayPreferences } from "@/hooks/wallet/useDisplayPreferences";
import { useSolPrice } from "@/hooks/wallet/useSolPrice";
import { useWalletBalance } from "@/hooks/wallet/useWalletBalance";
import { useWalletInit } from "@/hooks/wallet/useWalletInit";
import { ScrollView, Text, View } from "@/tw";

export default function WalletScreen() {
  const { walletAddress, isLoading, walletError, retryWalletInit } =
    useWalletInit();
  const { solBalanceLamports, refreshBalance } =
    useWalletBalance(walletAddress);
  const { solPriceUsd } = useSolPrice();
  const { displayCurrency, setDisplayCurrency } = useDisplayPreferences();

  const handleToggleCurrency = useCallback(() => {
    setDisplayCurrency((prev) => (prev === "USD" ? "SOL" : "USD"));
  }, [setDisplayCurrency]);

  const handleRefresh = useCallback(async () => {
    await refreshBalance(true);
  }, [refreshBalance]);

  // Full-screen loading state during initial wallet init
  if (isLoading && !walletAddress) {
    return (
      <SafeAreaView
        edges={["top"]}
        className="flex-1 items-center justify-center bg-white"
      >
        <ActivityIndicator size="large" color="#000" />
        <Text className="mt-3 text-sm text-neutral-500">
          Loading wallet...
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerClassName="pb-8"
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={handleRefresh} />
        }
      >
        <BalanceCard
          walletAddress={walletAddress}
          solBalanceLamports={solBalanceLamports}
          solPriceUsd={solPriceUsd}
          displayCurrency={displayCurrency}
          onToggleCurrency={handleToggleCurrency}
          isLoading={isLoading}
          walletError={walletError}
          onRetry={retryWalletInit}
        />

        {/* Action buttons */}
        <View className="mt-6 flex-row justify-center gap-8 px-4">
          <ActionButton
            icon={<ArrowUp size={22} color="white" strokeWidth={2} />}
            label="Send"
            onPress={() => {}}
          />
          <ActionButton
            icon={<ArrowDown size={22} color="white" strokeWidth={2} />}
            label="Receive"
            onPress={() => {}}
          />
          <ActionButton
            icon={<ArrowLeftRight size={22} color="white" strokeWidth={2} />}
            label="Swap"
            onPress={() => {}}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
