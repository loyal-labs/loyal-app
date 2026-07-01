import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { Check, ChevronDown, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
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

import type { EarnWithdrawSourceInfo } from "@/lib/solana/earn/earn-api";
import { resolveEarnPositionDisplay } from "@/lib/solana/earn/earn-position-display";
import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";

import { VenueBadge } from "./venueBadge";

const usdcLogo = require("../../../assets/images/earn/usdc.png");

// Per-market display for a withdrawal source, matching the web withdraw picker
// ("OnRe Market reserve" / "Idle vault USDC") and the Positions sheet — the
// backend only sends the generic "USDC reserve"/"Idle USDC" label plus the
// market pubkey, so the market name + venue badge are resolved on the client.
function sourceLabel(source: EarnWithdrawSourceInfo): string {
  if (source.type === "idle") {
    return "Idle vault USDC";
  }
  const { marketName } = resolveEarnPositionDisplay({
    market: source.market,
    liquidityMint: source.liquidityMint,
  });
  return `${marketName} reserve`;
}

// Token coin with the market's venue badge overlaid (same stack as the Positions
// sheet). `tokenSize` sets the coin diameter; the box grows to fit the badge.
function SourceIcon({
  source,
  tokenSize = 32,
}: {
  source: EarnWithdrawSourceInfo;
  tokenSize?: number;
}) {
  const { venue } = resolveEarnPositionDisplay({
    market: source.market,
    liquidityMint: source.liquidityMint,
  });
  const tokenIcon = resolveTokenIcon({ mint: source.liquidityMint });
  const box = tokenSize * 1.5;
  return (
    <View style={{ width: box, height: box }}>
      <Image
        source={{ uri: tokenIcon }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: tokenSize,
          height: tokenSize,
          borderRadius: tokenSize / 2,
        }}
        accessibilityLabel="USDC"
      />
      <View style={{ position: "absolute", bottom: 0, right: 0 }}>
        <VenueBadge venue={venue} size={tokenSize} />
      </View>
    </View>
  );
}

// Withdraw shares Deposit's visual language (toolbar, "$" amount input with a
// custom caret, balance/source cell + MAX, keyboard-riding CTA). When the Earn
// position spans multiple sources (reserves + idle vault USDC), the balance cell
// becomes a source picker (adapted from the Deposit source selector, Figma
// 74-18786): a tappable token pill with a chevron opens a source list, and the
// amount/MAX/validation key off the selected source — one source per withdrawal,
// matching the web flow.
const COLOR_LABEL_DIM = "rgba(60, 60, 67, 0.6)";
const COLOR_CHIP_BG = "#F2F2F7";
const COLOR_CHIP_SOFT = "rgba(0, 0, 0, 0.04)";
const COLOR_BLACK = "#000";
const COLOR_ERROR_BG = "rgba(249, 54, 60, 0.14)";
const COLOR_ERROR_TEXT = "#F9363C";

const SCREEN_HEIGHT = Dimensions.get("screen").height;
const SCREEN_WIDTH = Dimensions.get("screen").width;
const SHEET_HEIGHT = Math.floor(SCREEN_HEIGHT * 0.94);

const AMOUNT_MAX_FONT_SIZE = 48;
const AMOUNT_MIN_FONT_SIZE = 22;
const AMOUNT_CHAR_WIDTH_RATIO = 0.6;

const BALANCE_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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

function sourceBalanceUsd(source: EarnWithdrawSourceInfo): number {
  const raw = Number(source.amountRaw);
  return Number.isFinite(raw) ? raw / 1_000_000 : 0;
}

// Floors to 2 decimals so MAX never rounds UP past the real balance (5.939
// must show 5.93, not 5.94 — the latter reads as "insufficient balance"). The
// toFixed(4) absorbs float noise (5.939 * 100 === 593.9000000000001) before the
// floor. Mirrors the web `floorToBucks`.
function floorTo2(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(Number((value * 100).toFixed(4))) / 100;
}

type WithdrawSheetProps = {
  open: boolean;
  onClose: () => void;
  // May return a Promise — the button shows a loading spinner while pending.
  // `source` is the selected withdrawal source (null when the position has a
  // single implicit source / sources haven't loaded).
  onWithdraw?: (
    amountUsd: number,
    source: EarnWithdrawSourceInfo | null,
  ) => void | Promise<void>;
  // The user's withdrawable Earn balance (token units ≈ dollars). Used as the
  // cap when no per-source breakdown is available.
  availableUsdc?: number | null;
  // Per-source breakdown; when more than one, the cell becomes a source picker.
  sources?: EarnWithdrawSourceInfo[];
};

export function WithdrawSheet({
  open,
  onClose,
  onWithdraw,
  availableUsdc,
  sources,
}: WithdrawSheetProps) {
  const sheetRef = useRef<BottomSheetModal>(null);
  const sourceSheetRef = useRef<BottomSheetModal>(null);
  const inputRef = useRef<{ focus: () => void } | null>(null);
  const insets = useSafeAreaInsets();
  const [amount, setAmount] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [caretOn, setCaretOn] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  // MAX means "empty this source". The 2-decimal input can't hold the exact
  // balance (5.939), so we display a floored value but submit the exact amount.
  const [maxSelected, setMaxSelected] = useState(false);

  const snapPoints = useMemo(() => ["94%"], []);
  const sourceList = useMemo(() => sources ?? [], [sources]);
  const hasPicker = sourceList.length > 0;
  const isDropdown = sourceList.length > 1;
  const selectedSource =
    sourceList.find((source) => source.id === selectedSourceId) ?? null;
  const liveTotal = Number.isFinite(availableUsdc ?? NaN)
    ? (availableUsdc as number)
    : null;
  const selectedBalanceUsd = selectedSource
    ? sourceBalanceUsd(selectedSource)
    : 0;
  // The live on-chain total is authoritative; the per-source DB amounts lag the
  // chain and can read 0 right after a move. Keep the picked source's amount for
  // a genuine multi-source split (you withdraw one at a time) — but only when
  // those amounts reconcile with the live total. Otherwise the split is stale,
  // so cap at the live total like a single source, instead of letting a real
  // balance show 0 available.
  const sourcesReconcileWithLiveTotal =
    liveTotal != null &&
    sourceList.reduce((sum, source) => sum + sourceBalanceUsd(source), 0) >=
      liveTotal - 0.01;
  const available =
    sourceList.length > 1 && selectedSource && sourcesReconcileWithLiveTotal
      ? selectedBalanceUsd
      : (liveTotal ?? selectedBalanceUsd);

  useEffect(() => {
    if (open) {
      setAmount("");
      setSubmitError(null);
      setSubmitting(false);
      setSelectedSourceId(null);
      setMaxSelected(false);
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [open]);

  // Default the selection to the largest source once they load (or stay put if
  // the user already picked one that's still present).
  useEffect(() => {
    if (!open || sourceList.length === 0) {
      return;
    }
    if (sourceList.some((source) => source.id === selectedSourceId)) {
      return;
    }
    const largest = [...sourceList].sort(
      (a, b) => sourceBalanceUsd(b) - sourceBalanceUsd(a),
    )[0];
    setSelectedSourceId(largest?.id ?? null);
  }, [open, sourceList, selectedSourceId]);

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
    setMaxSelected(false);
    setAmount(sanitizeAmount(text));
  }, []);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    sheetRef.current?.dismiss();
  }, []);

  const handleMax = useCallback(() => {
    void Haptics.selectionAsync();
    setAmount(floorTo2(available).toFixed(2));
    setMaxSelected(true);
  }, [available]);

  const openSourceList = useCallback(() => {
    if (!isDropdown) {
      return;
    }
    void Haptics.selectionAsync();
    Keyboard.dismiss();
    sourceSheetRef.current?.present();
  }, [isDropdown]);

  const selectSource = useCallback((id: string) => {
    void Haptics.selectionAsync();
    setSelectedSourceId(id);
    setAmount("");
    setMaxSelected(false);
    sourceSheetRef.current?.dismiss();
  }, []);

  const enteredUsd = amountToUsd(amount);
  const isEmpty = enteredUsd <= 0;
  const insufficientFunds = !isEmpty && enteredUsd > available;
  const hasError = insufficientFunds;
  const disabled = isEmpty || hasError;
  const ctaLabel = insufficientFunds ? "Insufficient balance" : "Withdraw";

  const handleWithdraw = useCallback(async () => {
    if (disabled) {
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Keyboard.dismiss();
    setSubmitError(null);
    // MAX submits the exact source balance (not the floored display value) so it
    // triggers the caller's full-withdraw path and empties the source — the
    // display is capped at 2 decimals but the real amount has more precision.
    const amountToWithdraw = maxSelected ? available : enteredUsd;
    const result = onWithdraw?.(amountToWithdraw, selectedSource);
    if (!(result instanceof Promise)) {
      sheetRef.current?.dismiss();
      return;
    }
    setSubmitting(true);
    try {
      await result;
      sheetRef.current?.dismiss();
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Withdrawal failed. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [disabled, enteredUsd, maxSelected, available, onWithdraw, selectedSource]);

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
    <>
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
            <Text style={styles.toolbarTitle}>Withdraw</Text>
            <View style={styles.iconButtonSpacer} />
          </View>

          <View style={styles.body}>
            <View style={styles.amountInputWrap}>
              <View style={styles.amountRow}>
                <View style={styles.amountVisual} pointerEvents="none">
                  <Text
                    style={[styles.amountText, { fontSize: amountFontSize }]}
                  >
                    $
                  </Text>
                  <Text
                    style={[styles.amountText, { fontSize: amountFontSize }]}
                  >
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
                  accessibilityLabel="Withdraw amount"
                />
              </View>
            </View>
          </View>

          <Animated.View
            style={[
              styles.footerAbsolute,
              { paddingBottom: insets.bottom + 12 },
              animatedFooterStyle,
            ]}
          >
            <View style={styles.balanceCell}>
              {hasPicker ? (
                <Pressable
                  onPress={openSourceList}
                  disabled={!isDropdown}
                  accessibilityRole={isDropdown ? "button" : undefined}
                  accessibilityLabel="Choose withdrawal source"
                  style={({ pressed }) => [
                    styles.selectorPill,
                    { opacity: pressed && isDropdown ? 0.8 : 1 },
                  ]}
                  hitSlop={8}
                >
                  {selectedSource ? (
                    <SourceIcon source={selectedSource} tokenSize={28} />
                  ) : (
                    <Image
                      source={usdcLogo}
                      style={styles.tokenLogo}
                      accessibilityLabel="USDC"
                    />
                  )}
                  {isDropdown ? (
                    <ChevronDown
                      size={16}
                      color={COLOR_LABEL_DIM}
                      strokeWidth={2}
                    />
                  ) : null}
                </Pressable>
              ) : (
                <View style={styles.logoChip}>
                  <Image
                    source={usdcLogo}
                    style={styles.tokenLogo}
                    accessibilityLabel="USDC"
                  />
                </View>
              )}
              <View style={styles.balanceMiddle}>
                <Text style={styles.balanceAmount}>
                  {BALANCE_FORMATTER.format(available)}
                </Text>
                <Text style={styles.balanceAvailable} numberOfLines={1}>
                  {selectedSource ? sourceLabel(selectedSource) : "Available"}
                </Text>
              </View>
              <Pressable
                onPress={handleMax}
                accessibilityRole="button"
                accessibilityLabel="Use maximum balance"
                style={({ pressed }) => [
                  styles.maxBadge,
                  { opacity: pressed ? 0.8 : 1 },
                ]}
                hitSlop={8}
              >
                <Text style={styles.maxBadgeText}>MAX</Text>
              </Pressable>
            </View>

            {submitError ? (
              <Text style={styles.submitError}>{submitError}</Text>
            ) : null}

            <Pressable
              onPress={handleWithdraw}
              accessibilityRole="button"
              accessibilityLabel={ctaLabel}
              disabled={disabled || submitting}
              style={({ pressed }) => [
                styles.cta,
                hasError ? styles.ctaError : styles.ctaEnabled,
                !disabled && !submitting && pressed && styles.ctaPressed,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text
                  style={
                    hasError ? styles.ctaLabelError : styles.ctaLabelEnabled
                  }
                >
                  {ctaLabel}
                </Text>
              )}
            </Pressable>
          </Animated.View>
        </BottomSheetView>
      </BottomSheetModal>

      <BottomSheetModal
        ref={sourceSheetRef}
        enableDynamicSizing
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.sheetBackground}
        handleIndicatorStyle={styles.sourceHandle}
      >
        <BottomSheetView
          style={{
            paddingHorizontal: 12,
            paddingBottom: insets.bottom + 12,
            paddingTop: 4,
          }}
        >
          <Text style={styles.sourceListTitle}>Withdraw from</Text>
          {sourceList.map((source) => {
            const isSelected = source.id === selectedSourceId;
            const label = sourceLabel(source);
            return (
              <Pressable
                key={source.id}
                onPress={() => selectSource(source.id)}
                accessibilityRole="button"
                accessibilityLabel={label}
                style={({ pressed }) => [
                  styles.sourceRow,
                  { backgroundColor: pressed ? COLOR_CHIP_BG : "transparent" },
                ]}
              >
                <SourceIcon source={source} />
                <View style={styles.sourceRowMiddle}>
                  <Text style={styles.sourceRowLabel} numberOfLines={1}>
                    {label}
                  </Text>
                  <Text style={styles.sourceRowBalance}>
                    {BALANCE_FORMATTER.format(sourceBalanceUsd(source))}
                  </Text>
                </View>
                {isSelected ? (
                  <Check size={22} color={COLOR_BLACK} strokeWidth={2} />
                ) : null}
              </Pressable>
            );
          })}
        </BottomSheetView>
      </BottomSheetModal>
    </>
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
    paddingTop: 36,
  },
  amountInputWrap: {
    paddingBottom: 24,
  },
  amountRow: {
    position: "relative",
    height: 48,
    justifyContent: "flex-end",
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
  balanceCell: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  logoChip: {
    padding: 4,
    borderRadius: 999,
    backgroundColor: COLOR_CHIP_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },
  selectorPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 4,
    paddingRight: 8,
    paddingVertical: 4,
    borderRadius: 61,
    backgroundColor: COLOR_CHIP_SOFT,
  },
  tokenLogo: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  balanceMiddle: {
    flex: 1,
    paddingVertical: 8,
  },
  balanceAmount: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 20,
    lineHeight: 24,
    color: COLOR_BLACK,
  },
  balanceAvailable: {
    fontFamily: "Geist_400Regular",
    fontSize: 15,
    lineHeight: 20,
    color: COLOR_LABEL_DIM,
  },
  maxBadge: {
    minWidth: 64,
    backgroundColor: COLOR_CHIP_SOFT,
    borderRadius: 40,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  maxBadgeText: {
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    lineHeight: 20,
    color: COLOR_BLACK,
    textAlign: "center",
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
  cta: {
    height: 50,
    borderRadius: 9999,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaEnabled: {
    backgroundColor: COLOR_BLACK,
  },
  ctaError: {
    backgroundColor: COLOR_ERROR_BG,
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaLabelEnabled: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 22,
    color: "#FFF",
  },
  ctaLabelError: {
    fontFamily: "Geist_500Medium",
    fontSize: 16,
    lineHeight: 20,
    color: COLOR_ERROR_TEXT,
    textAlign: "center",
  },
  submitError: {
    fontFamily: "Geist_400Regular",
    fontSize: 14,
    lineHeight: 20,
    color: COLOR_ERROR_TEXT,
    textAlign: "center",
    marginBottom: 12,
  },
  sourceHandle: {
    backgroundColor: "rgba(60, 60, 67, 0.3)",
    width: 40,
  },
  sourceListTitle: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 17,
    lineHeight: 22,
    color: COLOR_BLACK,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 4,
  },
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 16,
  },
  sourceRowMiddle: {
    flex: 1,
  },
  sourceRowLabel: {
    fontFamily: "Geist_500Medium",
    fontSize: 16,
    lineHeight: 20,
    color: COLOR_BLACK,
  },
  sourceRowBalance: {
    fontFamily: "Geist_400Regular",
    fontSize: 14,
    lineHeight: 18,
    color: COLOR_LABEL_DIM,
    marginTop: 2,
  },
});
