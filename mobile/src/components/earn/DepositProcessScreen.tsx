import { router } from "expo-router";
import { X } from "lucide-react-native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { executeEarnDeposit } from "@/lib/solana/earn/deposit";
import { markEarnDeposited } from "@/lib/solana/earn/result";
import { isWalletUnlocked, useWallet } from "@/lib/wallet/wallet-provider";

const COLOR_BLACK = "#000";
const COLOR_CHIP_BG = "#F2F2F7";
const COLOR_LABEL_DIM = "rgba(60, 60, 67, 0.6)";
const COLOR_ERROR_TEXT = "#F9363C";

const CURRENCY_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type DepositProcessScreenProps = {
  // USD amount to deposit, forwarded from the Deposit sheet (USDC ≈ $1).
  amountUsd: number;
};

// Runs the real on-chain Earn deposit: the backend prepares the transaction(s)
// for the wallet's smart account and the device wallet signs + sends each stage.
// On success it returns to the Earn tab, which then shows its funded state.
export function DepositProcessScreen({ amountUsd }: DepositProcessScreenProps) {
  const insets = useSafeAreaInsets();
  const { signer, state } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    if (loading) {
      return;
    }
    router.back();
  }, [loading]);

  const handleConfirm = useCallback(async () => {
    if (loading) {
      return;
    }
    setError(null);
    if (!signer || !isWalletUnlocked(state)) {
      setError("Unlock your wallet to deposit.");
      return;
    }
    setLoading(true);
    try {
      await executeEarnDeposit({ signer, amountUsd });
      markEarnDeposited(amountUsd);
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed.");
    } finally {
      setLoading(false);
    }
  }, [loading, signer, state, amountUsd]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.toolbar}>
        <Pressable
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          disabled={loading}
          style={({ pressed }) => [
            styles.iconButton,
            { opacity: pressed ? 0.7 : 1 },
          ]}
          hitSlop={12}
        >
          <X size={24} color="#1C1C1E" strokeWidth={2} />
        </Pressable>
        <Text style={styles.toolbarTitle}>Deposit</Text>
        <View style={styles.iconButtonSpacer} />
      </View>

      <View style={styles.body}>
        <Text style={styles.amount}>
          {CURRENCY_FORMATTER.format(Number.isFinite(amountUsd) ? amountUsd : 0)}
        </Text>
        <Text style={styles.caption}>into Earn</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          onPress={handleConfirm}
          accessibilityRole="button"
          accessibilityLabel="Confirm deposit"
          disabled={loading}
          style={({ pressed }) => [
            styles.cta,
            (pressed || loading) && styles.ctaPressed,
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.ctaLabel}>Confirm deposit</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FFF",
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLOR_CHIP_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonSpacer: {
    width: 44,
    height: 44,
  },
  toolbarTitle: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 17,
    lineHeight: 22,
    color: COLOR_BLACK,
    textAlign: "center",
  },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 4,
  },
  amount: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 48,
    lineHeight: 52,
    letterSpacing: -0.4,
    color: COLOR_BLACK,
  },
  caption: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 22,
    color: COLOR_LABEL_DIM,
  },
  error: {
    marginTop: 16,
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 20,
    color: COLOR_ERROR_TEXT,
    textAlign: "center",
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  cta: {
    height: 50,
    borderRadius: 9999,
    backgroundColor: COLOR_BLACK,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaLabel: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 22,
    color: "#FFF",
  },
});
