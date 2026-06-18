import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { Info, Trash2, Wallet, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AutodepositIcon from "../../../assets/images/earn/autodeposit.svg";

// Autodeposit set-up sheet (Figma 74-18887). Enter the wallet balance to keep;
// anything above it auto-routes to Earn. The "edit" mode (settings icon on the
// control) is identical except the CTA reads "Confirm". Mirrors DepositSheet's
// input + keyboard-riding footer mechanics.
const SCREEN_HEIGHT = Dimensions.get("screen").height;
const SCREEN_WIDTH = Dimensions.get("screen").width;
const SHEET_HEIGHT = Math.floor(SCREEN_HEIGHT * 0.94);

const AMOUNT_MAX_FONT_SIZE = 48;
const AMOUNT_MIN_FONT_SIZE = 22;
const AMOUNT_CHAR_WIDTH_RATIO = 0.6;

const COLOR_BLACK = "#000";
const COLOR_LABEL_DIM = "rgba(60, 60, 67, 0.6)";
const COLOR_CENTS_DIM = "rgba(60, 60, 67, 0.4)";
const COLOR_CHIP_BG = "#F2F2F7";
const COLOR_RED = "#F9363C";
const COLOR_WALLET_GREEN = "#32B67C";
const COLOR_CONNECTOR = "rgba(0, 0, 0, 0.14)";

function sanitizeAmount(input: string): string {
  let cleaned = input.replace(/[^0-9.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length > 2) {
    cleaned = `${parts[0]}.${parts.slice(1).join("")}`;
  }
  const [intPart, decPart] = cleaned.split(".");
  const normalizedInt = intPart ? intPart.replace(/^0+(?=\d)/, "") : intPart;
  const trimmedDec = decPart !== undefined ? decPart.slice(0, 2) : undefined;
  return trimmedDec !== undefined
    ? `${normalizedInt || "0"}.${trimmedDec}`
    : normalizedInt;
}

function formatAmountDisplay(raw: string): string {
  if (!raw) {
    return "";
  }
  const trailingDot = raw.endsWith(".") && !raw.slice(0, -1).includes(".");
  const [intPart, decPart] = raw.split(".");
  const intNum = Number(intPart || "0");
  const intText = Number.isFinite(intNum)
    ? intNum.toLocaleString("en-US")
    : intPart || "0";
  if (trailingDot) {
    return `${intText}.`;
  }
  return decPart !== undefined ? `${intText}.${decPart}` : intText;
}

function amountToUsd(raw: string): number {
  if (!raw) {
    return 0;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitDollars(value: number): { whole: string; cents: string } {
  const [whole, cents] = value.toFixed(2).split(".");
  return {
    whole: `$${Number(whole).toLocaleString("en-US")}`,
    cents: `.${cents}`,
  };
}

function shortenAddress(address: string | null): string {
  if (!address || address.length <= 9) {
    return address ?? "";
  }
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function AutodepositSetupSheet({
  open,
  onClose,
  onConfirm,
  onDelete,
  mode,
  initialThresholdUsd,
  availableUsdc,
  walletAddress,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (thresholdUsd: number) => void;
  onDelete?: () => void;
  mode: "create" | "edit";
  initialThresholdUsd: number | null;
  availableUsdc: number | null;
  walletAddress: string | null;
}) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const inputRef = useRef<{ focus: () => void } | null>(null);
  const insets = useSafeAreaInsets();
  const [amount, setAmount] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [caretOn, setCaretOn] = useState(true);

  const snapPoints = useMemo(() => ["94%"], []);
  const balance = Number.isFinite(availableUsdc ?? NaN)
    ? (availableUsdc as number)
    : 0;

  useEffect(() => {
    if (open) {
      setAmount(
        mode === "edit" && initialThresholdUsd != null && initialThresholdUsd > 0
          ? String(initialThresholdUsd)
          : "",
      );
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [open, mode, initialThresholdUsd]);

  useEffect(() => {
    if (!isFocused) {
      setCaretOn(true);
      return;
    }
    const id = setInterval(() => setCaretOn((v) => !v), 530);
    return () => clearInterval(id);
  }, [isFocused]);

  const handleSheetChange = useCallback((index: number) => {
    if (index >= 0) {
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, []);

  const handleAmountChange = useCallback((text: string) => {
    setAmount(sanitizeAmount(text));
  }, []);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    sheetRef.current?.dismiss();
  }, []);

  const handleDelete = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Keyboard.dismiss();
    sheetRef.current?.dismiss();
    onDelete?.();
  }, [onDelete]);

  const thresholdUsd = amountToUsd(amount);
  // The design's only validation: a $0 threshold can't create an autodeposit.
  const disabled = thresholdUsd <= 0;

  const handleConfirm = useCallback(() => {
    if (disabled) {
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Keyboard.dismiss();
    sheetRef.current?.dismiss();
    onConfirm(thresholdUsd);
  }, [disabled, onConfirm, thresholdUsd]);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.2}
      />
    ),
    [],
  );

  const displayValue = formatAmountDisplay(amount);
  const toEarn = Math.max(0, balance - thresholdUsd);
  const fromParts = splitDollars(balance);
  const toParts = splitDollars(toEarn);
  const ctaLabel = mode === "edit" ? "Confirm" : "Create Autodeposit";

  const amountFontSize = useMemo(() => {
    const text = `$${displayValue || "0"}`;
    const availableWidth = SCREEN_WIDTH - 48;
    const fitted = Math.floor(
      availableWidth / (text.length * AMOUNT_CHAR_WIDTH_RATIO),
    );
    return Math.max(
      AMOUNT_MIN_FONT_SIZE,
      Math.min(AMOUNT_MAX_FONT_SIZE, fitted),
    );
  }, [displayValue]);

  const keyboard = useAnimatedKeyboard();
  const animatedFooterStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboard.height.value }],
  }));

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
      onChange={handleSheetChange}
      handleComponent={null}
      backgroundStyle={styles.sheetBackground}
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetView style={styles.container}>
        <View style={styles.toolbar}>
          <Pressable
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={({ pressed }) => [
              styles.iconButton,
              { opacity: pressed ? 0.7 : 1 },
            ]}
            hitSlop={12}
          >
            <X size={24} color="#1C1C1E" strokeWidth={2} />
          </Pressable>
          <Text style={styles.toolbarTitle}>Autodeposit</Text>
          {mode === "edit" ? (
            <Pressable
              onPress={handleDelete}
              accessibilityRole="button"
              accessibilityLabel="Delete Autodeposit"
              style={({ pressed }) => [
                styles.iconButton,
                styles.deleteButton,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              hitSlop={12}
            >
              <Trash2 size={24} color={COLOR_RED} strokeWidth={2} />
            </Pressable>
          ) : (
            <View style={styles.iconButtonSpacer} />
          )}
        </View>

        <View style={styles.body}>
          <Text style={styles.inputLabel}>Deposit anything above</Text>
          <View style={styles.amountRow}>
            <View style={styles.amountVisual} pointerEvents="none">
              <Text style={[styles.amountText, { fontSize: amountFontSize }]}>
                $
              </Text>
              <Text style={[styles.amountText, { fontSize: amountFontSize }]}>
                {displayValue || "0"}
              </Text>
              <View
                style={[
                  styles.caret,
                  { opacity: isFocused && caretOn ? 1 : 0 },
                ]}
              />
            </View>
            <BottomSheetTextInput
              ref={inputRef as unknown as React.Ref<never>}
              value={displayValue}
              onChangeText={handleAmountChange}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              keyboardType="decimal-pad"
              inputMode="decimal"
              maxLength={15}
              caretHidden
              style={styles.overlayInput}
              accessibilityLabel="Autodeposit threshold"
            />
          </View>
          <View style={styles.caption}>
            <Info size={20} color={COLOR_RED} strokeWidth={2} />
            <Text style={styles.captionText}>
              Any stablecoins above this amount will automatically go to Earn
            </Text>
          </View>
        </View>

        <Animated.View
          style={[
            styles.footerAbsolute,
            { paddingBottom: insets.bottom + 12 },
            animatedFooterStyle,
          ]}
        >
          <View style={styles.flow}>
            <View style={styles.flowCell}>
              <View style={styles.walletIcon}>
                <Wallet size={24} color="#FFF" strokeWidth={2} />
              </View>
              <View style={styles.flowMiddle}>
                <Text style={styles.flowSubtitle}>
                  from {shortenAddress(walletAddress)}
                </Text>
                <Text style={styles.flowAmount}>
                  <Text style={styles.flowAmountWhole}>{fromParts.whole}</Text>
                  <Text style={styles.flowAmountCents}>{fromParts.cents}</Text>
                </Text>
              </View>
            </View>
            <View style={styles.connector} />
            <View style={styles.flowCell}>
              <AutodepositIcon width={48} height={48} />
              <View style={styles.flowMiddle}>
                <Text style={styles.flowSubtitle}>to Earn</Text>
                <Text style={styles.flowAmount}>
                  <Text style={styles.flowAmountWhole}>{toParts.whole}</Text>
                  <Text style={styles.flowAmountCents}>{toParts.cents}</Text>
                </Text>
              </View>
            </View>
          </View>

          <Pressable
            onPress={handleConfirm}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            disabled={disabled}
            style={({ pressed }) => [
              styles.cta,
              disabled ? styles.ctaDisabled : styles.ctaEnabled,
              !disabled && pressed && styles.ctaPressed,
            ]}
          >
            <Text
              style={disabled ? styles.ctaLabelDisabled : styles.ctaLabelEnabled}
            >
              {ctaLabel}
            </Text>
          </Pressable>
        </Animated.View>
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
    height: SHEET_HEIGHT,
    backgroundColor: "#FFF",
    borderTopLeftRadius: 38,
    borderTopRightRadius: 38,
    overflow: "hidden",
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
  deleteButton: {
    backgroundColor: "rgba(249, 54, 60, 0.14)",
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
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  inputLabel: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 20,
    color: COLOR_LABEL_DIM,
  },
  amountRow: {
    position: "relative",
    height: 48,
    justifyContent: "flex-end",
    marginTop: 4,
  },
  amountVisual: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  amountText: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 48,
    lineHeight: 48,
    color: COLOR_BLACK,
    includeFontPadding: false,
  },
  caret: {
    width: 2,
    height: 40,
    marginHorizontal: 2,
    marginBottom: 4,
    borderRadius: 1,
    backgroundColor: COLOR_BLACK,
  },
  overlayInput: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    padding: 0,
    fontSize: 48,
  },
  caption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
  },
  captionText: {
    flex: 1,
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 20,
    color: COLOR_RED,
  },
  footerAbsolute: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#FFF",
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  flow: {
    position: "relative",
    gap: 8,
    marginBottom: 16,
  },
  flowCell: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  walletIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: COLOR_WALLET_GREEN,
    alignItems: "center",
    justifyContent: "center",
  },
  flowMiddle: {
    flex: 1,
    paddingVertical: 9,
  },
  flowSubtitle: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 20,
    color: COLOR_LABEL_DIM,
  },
  flowAmount: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 20,
    lineHeight: 24,
  },
  flowAmountWhole: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 20,
    lineHeight: 24,
    color: COLOR_BLACK,
  },
  flowAmountCents: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 20,
    lineHeight: 24,
    color: COLOR_CENTS_DIM,
  },
  // Short vertical tick joining the two cells' icons (Figma 75:32258).
  connector: {
    position: "absolute",
    left: 23,
    top: 54,
    width: 2,
    height: 18,
    borderRadius: 2,
    backgroundColor: COLOR_CONNECTOR,
  },
  cta: {
    height: 50,
    borderRadius: 78,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaEnabled: {
    backgroundColor: COLOR_BLACK,
  },
  ctaDisabled: {
    backgroundColor: COLOR_CHIP_BG,
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaLabelEnabled: {
    fontFamily: "Geist_500Medium",
    fontSize: 16,
    lineHeight: 20,
    color: "#FFF",
  },
  ctaLabelDisabled: {
    fontFamily: "Geist_500Medium",
    fontSize: 16,
    lineHeight: 20,
    color: "rgba(60, 60, 67, 0.3)",
  },
});
