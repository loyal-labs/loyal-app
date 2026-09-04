import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import type { ShieldedBalance, UnshieldResult } from "@loyal-labs/wallet-core/hooks";
import { X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useFixedSheetLayout } from "@/hooks/useFixedSheetLayout";
import type { TokenDetailsByMint } from "@/hooks/wallet/useTokenDetails";
import { NATIVE_SOL_DECIMALS, NATIVE_SOL_MINT } from "@/lib/solana/constants";
import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import {
  resolveTokenIcon,
  resolveTokenSymbol,
} from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { Pressable, Text, View } from "@/tw";

// Exit-only unshield for the sunset private-transfer program (ASK-2269): one
// row per shielded token, full-balance unshield, no shield / private send.

const COLOR_CARD_BG = "#F2F2F7";
const COLOR_ICON = "#3C3C43";
const MUTED = "rgba(60, 60, 67, 0.6)";

type UnshieldSheetProps = {
  open: boolean;
  onClose: () => void;
  balances: ShieldedBalance[];
  executeUnshield: (tokenMint: string) => Promise<UnshieldResult>;
  tokenHoldings: TokenHolding[];
  tokenDetailsByMint: TokenDetailsByMint;
  onUnshieldComplete?: () => void;
};

export function UnshieldSheet({
  open,
  onClose,
  balances,
  executeUnshield,
  tokenHoldings,
  tokenDetailsByMint,
  onUnshieldComplete,
}: UnshieldSheetProps) {
  const { sheetHeight, snapPoints } = useFixedSheetLayout(0.6);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const insets = useSafeAreaInsets();
  const [pendingMint, setPendingMint] = useState<string | null>(null);
  const [result, setResult] = useState<UnshieldResult | null>(null);

  useEffect(() => {
    if (open) {
      setResult(null);
      bottomSheetRef.current?.present();
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [open]);

  const handleUnshield = useCallback(
    async (tokenMint: string) => {
      setPendingMint(tokenMint);
      setResult(null);
      const res = await executeUnshield(tokenMint);
      setPendingMint(null);
      setResult(res);
      if (res.success) onUnshieldComplete?.();
    },
    [executeUnshield, onUnshieldComplete],
  );

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

  const env = getSolanaEnv();
  const explorerUrl = result?.signature
    ? `https://solscan.io/tx/${result.signature}${env === "mainnet" ? "" : `?cluster=${env}`}`
    : null;

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
      handleComponent={null}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={[styles.container, { height: sheetHeight }]}>
        <View className="flex-row items-center justify-between px-4 py-4">
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={styles.iconButton}
          >
            <X size={28} color={COLOR_ICON} strokeWidth={2} opacity={0.6} />
          </Pressable>
          <Text className="text-[17px] font-semibold text-black" style={{ lineHeight: 22 }}>
            Unshield
          </Text>
          <View style={styles.iconButtonSpacer} />
        </View>

        <Text className="px-6 pb-4 text-center text-[14px]" style={{ lineHeight: 20, color: MUTED }}>
          Private balances are being retired. Move each balance back to your wallet.
        </Text>

        <View className="px-4 gap-2">
          {balances.map((balance) => {
            const holding = tokenHoldings.find((h) => h.mint === balance.tokenMint);
            const detail = tokenDetailsByMint[balance.tokenMint];
            const decimals =
              holding?.decimals ??
              detail?.token.decimals ??
              (balance.tokenMint === NATIVE_SOL_MINT ? NATIVE_SOL_DECIMALS : 6);
            const symbol = resolveTokenSymbol({
              mint: balance.tokenMint,
              detailSymbol: detail?.token.symbol,
              holdingSymbol: holding?.symbol,
            });
            const icon = resolveTokenIcon({
              mint: balance.tokenMint,
              imageUrl: holding?.imageUrl,
              detailLogoUrl: detail?.token.logoUrl,
            });
            const amount = Number(balance.amountRaw) / 10 ** decimals;
            const isPending = pendingMint === balance.tokenMint;
            return (
              <View key={balance.tokenMint} style={styles.row}>
                <Image source={{ uri: icon }} style={styles.icon} />
                <View className="flex-1">
                  <Text className="text-[17px] font-medium text-black">{symbol}</Text>
                  <Text className="text-[14px]" style={{ color: MUTED }}>
                    {amount.toLocaleString("en-US", { maximumFractionDigits: decimals })}
                  </Text>
                </View>
                <Pressable
                  onPress={() => void handleUnshield(balance.tokenMint)}
                  disabled={pendingMint !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`Unshield ${symbol}`}
                  style={[styles.button, { opacity: pendingMint !== null && !isPending ? 0.4 : 1 }]}
                >
                  {isPending ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text className="text-[15px] font-medium text-white">Unshield</Text>
                  )}
                </Pressable>
              </View>
            );
          })}
          {balances.length === 0 ? (
            <Text className="py-6 text-center text-[14px]" style={{ color: MUTED }}>
              No shielded balances left.
            </Text>
          ) : null}
        </View>

        <View className="px-4" style={{ paddingBottom: insets.bottom + 12, marginTop: "auto" }}>
          {result?.error ? (
            <Text className="text-center text-[14px] text-[#f97362]" style={{ lineHeight: 20 }}>
              {result.error}
            </Text>
          ) : null}
          {explorerUrl ? (
            <Pressable onPress={() => void Linking.openURL(explorerUrl)} accessibilityRole="link">
              <Text className="text-center text-[14px] text-[#24a148]" style={{ lineHeight: 20 }}>
                Unshielded. View on Solscan
              </Text>
            </Pressable>
          ) : null}
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 38,
    borderTopRightRadius: 38,
  },
  container: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 38,
    borderTopRightRadius: 38,
    overflow: "hidden",
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLOR_CARD_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonSpacer: { width: 44, height: 44 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: COLOR_CARD_BG,
  },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#fff" },
  button: {
    height: 40,
    minWidth: 96,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
});
