import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { X } from "lucide-react-native";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
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

const usdcLogo = require("../../../assets/images/earn/usdc.png");

// Earn only accepts USDC, so the asset is fixed and the selector is replaced
// by a static logo chip (Figma 75:33570, annotation "вместо селекта").
const MIN_DEPOSIT_USD = 5;

const COLOR_LABEL_DIM = "rgba(60, 60, 67, 0.6)";
const COLOR_CHIP_BG = "#F2F2F7";
const COLOR_CHIP_SOFT = "rgba(0, 0, 0, 0.04)";
const COLOR_BLACK = "#000";
const COLOR_ERROR_BG = "rgba(249, 54, 60, 0.14)";
const COLOR_ERROR_TEXT = "#F9363C";

// `Dimensions.get('screen')` returns the full physical screen height — does
// NOT shrink when the keyboard opens (unlike `useWindowDimensions`, which
// follows the window and can be racy inside the modal portal). This lets us
// pin BottomSheetView to a definite height matching the modal's snap point.
const SCREEN_HEIGHT = Dimensions.get("screen").height;
const SCREEN_WIDTH = Dimensions.get("screen").width;
const SHEET_HEIGHT = Math.floor(SCREEN_HEIGHT * 0.94);

// Amount auto-shrink: when "$12,345.67" gets too wide for the row, the font
// scales down so it stays on one line, while `lineHeight` stays pinned at the
// max size (so the baseline/vertical metrics don't shift). RN has no
// synchronous text measurement, so width is approximated from the character
// count — close enough for the decimal-pad character set.
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
  // Drop commas (used for display) and any other non-numeric characters.
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
  if (!raw) return "";
  // Preserve a trailing decimal point while the user is mid-typing.
  const trailingDot = raw.endsWith(".") && !raw.slice(0, -1).includes(".");
  const [intPart, decPart] = raw.split(".");
  const intNum = Number(intPart || "0");
  const intText = Number.isFinite(intNum)
    ? intNum.toLocaleString("en-US")
    : intPart || "0";
  if (trailingDot) return `${intText}.`;
  return decPart !== undefined ? `${intText}.${decPart}` : intText;
}

function amountToUsd(raw: string): number {
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

type DepositSheetProps = {
  open: boolean;
  onClose: () => void;
  onDeposit?: () => void;
  // The wallet's spendable USDC balance (token units ≈ dollars). `null` while
  // holdings are still loading or the wallet has no USDC.
  availableUsdc?: number | null;
};

export function DepositSheet({
  open,
  onClose,
  onDeposit,
  availableUsdc,
}: DepositSheetProps) {
  const sheetRef = useRef<BottomSheetModal>(null);
  // The underlying input is gesture-handler's TextInput (forwarded through
  // @gorhom/bottom-sheet); only `.focus()` is called here.
  const inputRef = useRef<{ focus: () => void } | null>(null);
  const insets = useSafeAreaInsets();
  const [amount, setAmount] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [caretOn, setCaretOn] = useState(true);

  const snapPoints = useMemo(() => ["94%"], []);
  const available = Number.isFinite(availableUsdc ?? NaN)
    ? (availableUsdc as number)
    : 0;

  useEffect(() => {
    if (open) {
      setAmount("");
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [open]);

  // Custom caret blink — native caret is hidden so we control timing/size.
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
      // Focus once the sheet is at its snap point — earlier focus collides
      // with the present animation and the keyboard ends up above the sheet.
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, []);

  const handleAmountChange = useCallback((text: string) => {
    setAmount(sanitizeAmount(text));
  }, []);

  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    sheetRef.current?.dismiss();
  }, []);

  const handleMax = useCallback(() => {
    void Haptics.selectionAsync();
    setAmount(available.toFixed(2));
  }, [available]);

  const handleDeposit = useCallback(() => {
    const usd = amountToUsd(amount);
    if (usd < MIN_DEPOSIT_USD || usd > available) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Keyboard.dismiss();
    onDeposit?.();
    sheetRef.current?.dismiss();
  }, [amount, available, onDeposit]);

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
  const enteredUsd = amountToUsd(amount);
  // < $5 (incl. the empty/zero state) → "Minimum"; ≥ $5 but over the wallet
  // balance → "Insufficient balance". Both render the same red, non-pressable
  // CTA; the minimum check takes precedence.
  const belowMinimum = enteredUsd < MIN_DEPOSIT_USD;
  const insufficientFunds = !belowMinimum && enteredUsd > available;
  const hasError = belowMinimum || insufficientFunds;
  const ctaLabel = belowMinimum
    ? "Minimum deposit is $5"
    : insufficientFunds
      ? "Insufficient balance"
      : "Deposit";

  // Scale the amount text down to fit the row; line-height stays pinned at the
  // max size (see AMOUNT_* constants) so the baseline doesn't move.
  const amountFontSize = useMemo(() => {
    const text = `$${displayValue || "0"}`;
    const availableWidth = SCREEN_WIDTH - 48;
    const fitted = Math.floor(
      availableWidth / (text.length * AMOUNT_CHAR_WIDTH_RATIO),
    );
    return Math.max(AMOUNT_MIN_FONT_SIZE, Math.min(AMOUNT_MAX_FONT_SIZE, fitted));
  }, [displayValue]);

  // gorhom's BottomSheetFooter zeroes out keyboard height on Android with
  // `adjustResize` (BottomSheet.js:1168), assuming the portal container will
  // shrink — it often doesn't. Drive the footer position with reanimated's
  // `useAnimatedKeyboard` instead, which reads the actual keyboard height
  // from the system regardless of input mode. The footer sits absolute at
  // the bottom of the sheet, then translates up by the keyboard height.
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
      // Keep the sheet at its 94% snap when the keyboard opens — neither
      // gorhom nor the OS pans it. Footer is animated separately via
      // `useAnimatedKeyboard` below, so the sheet itself doesn't need to
      // move. `adjustResize` lets the system keep the focused input visible
      // without panning the sheet content into the status bar.
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetView style={styles.container}>
        {/* Toolbar — three flex children so the absolute title doesn't eat
            taps on the close button (the bug in the previous version). */}
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
          <Text style={styles.toolbarTitle}>Deposit</Text>
          <View style={styles.iconButtonSpacer} />
        </View>

        {/* Amount input — a transparent BottomSheetTextInput covers the row
            and captures taps/keyboard. The visible "$" + digits + caret are
            rendered on top via pointerEvents="none" so they don't block
            re-focusing. The value is entered in dollars (USDC ≈ $1). */}
        <View style={styles.body}>
          <View style={styles.amountInputWrap}>
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
              {/* Transparent overlay input — sits on top of the row, captures
                  taps directly so re-focus after keyboard dismiss is just a
                  tap (no JS .focus() roundtrip needed). */}
              <BottomSheetTextInput
                ref={inputRef as unknown as React.Ref<never>}
                value={displayValue}
                onChangeText={handleAmountChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                keyboardType="decimal-pad"
                inputMode="decimal"
                maxLength={15}
                caretHidden
                style={styles.overlayInput}
                accessibilityLabel="Deposit amount"
              />
            </View>
          </View>
        </View>

        {/* CTA: absolute at the sheet's bottom, translated up by keyboard
            height via `useAnimatedKeyboard`. Stays glued to the keyboard
            top when it's open, and to the safe-area bottom when it's not. */}
        <Animated.View
          style={[
            styles.footerAbsolute,
            { paddingBottom: insets.bottom + 12 },
            animatedFooterStyle,
          ]}
        >
          {/* Balance cell — USDC only, so the selector is a static logo chip
              with the available balance and a MAX shortcut. Lives directly
              above the CTA (not under the input) and rides up with the
              keyboard alongside the button. */}
          <View style={styles.balanceCell}>
            <View style={styles.logoChip}>
              <Image
                source={usdcLogo}
                style={styles.tokenLogo}
                accessibilityLabel="USDC"
              />
            </View>
            <View style={styles.balanceMiddle}>
              <Text style={styles.balanceAmount}>
                {BALANCE_FORMATTER.format(available)}
              </Text>
              <Text style={styles.balanceAvailable}>Available</Text>
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

          <Pressable
            onPress={handleDeposit}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            disabled={hasError}
            style={({ pressed }) => [
              styles.cta,
              hasError ? styles.ctaError : styles.ctaEnabled,
              !hasError && pressed && styles.ctaPressed,
            ]}
          >
            <Text style={hasError ? styles.ctaLabelError : styles.ctaLabelEnabled}>
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
    // Definite height matching the modal's snap point. Without an explicit
    // height, BottomSheetView sizes to content and absolute `bottom: 0`
    // children land at the content's bottom, not the sheet's bottom.
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
    // Bottom-align so the "$", digits, and caret share a baseline. Pinning
    // each Text's `lineHeight` to its `fontSize` makes line-box-bottom ≈
    // baseline (no descenders in "$" / 0–9), so flex-end reads as baseline.
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
    // `opacity: 0` (not `color: "transparent"`) — on Android the latter
    // doesn't reliably hide BottomSheetTextInput's text rendering, which
    // double-draws the digit on top of the visible <Text>. Opacity 0 hides
    // the whole input while still receiving focus/keyboard.
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
});
