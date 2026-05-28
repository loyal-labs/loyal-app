import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import * as Haptics from "expo-haptics";
import { ArrowDownUp, ChevronDown, X } from "lucide-react-native";
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

const TOKEN_SYMBOL = "USDC";
const TOKEN_BALANCE_USD = 6266.86;

const COLOR_DIM = "rgba(60, 60, 67, 0.4)";
const COLOR_LABEL_DIM = "rgba(60, 60, 67, 0.6)";
const COLOR_CHIP_BG = "#F2F2F7";
const COLOR_BLACK = "#000";
const COLOR_DISABLED_BG = "#E5E5EA";
const COLOR_DISABLED_TEXT = "#8E8E93";

// `Dimensions.get('screen')` returns the full physical screen height — does
// NOT shrink when the keyboard opens (unlike `useWindowDimensions`, which
// follows the window and can be racy inside the modal portal). This lets us
// pin BottomSheetView to a definite height matching the modal's snap point.
const SCREEN_HEIGHT = Dimensions.get("screen").height;
const SHEET_HEIGHT = Math.floor(SCREEN_HEIGHT * 0.94);

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

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
};

export function DepositSheet({ open, onClose, onDeposit }: DepositSheetProps) {
  const sheetRef = useRef<BottomSheetModal>(null);
  // The underlying input is gesture-handler's TextInput (forwarded through
  // @gorhom/bottom-sheet); only `.focus()` is called here.
  const inputRef = useRef<{ focus: () => void } | null>(null);
  const insets = useSafeAreaInsets();
  const [amount, setAmount] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [caretOn, setCaretOn] = useState(true);

  const snapPoints = useMemo(() => ["94%"], []);

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
    setAmount(TOKEN_BALANCE_USD.toFixed(2));
  }, []);

  const handleDeposit = useCallback(() => {
    const usd = amountToUsd(amount);
    if (usd <= 0) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Keyboard.dismiss();
    onDeposit?.();
    sheetRef.current?.dismiss();
  }, [amount, onDeposit]);

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

  const usdValue = amountToUsd(amount);
  const displayValue = formatAmountDisplay(amount);
  const depositDisabled = usdValue <= 0;

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
            and captures taps/keyboard. The visible digit + caret are rendered
            on top via pointerEvents="none" so they don't block re-focusing. */}
        <View style={styles.body}>
          <View style={styles.amountSection}>
            <View style={styles.amountRow}>
              <View style={styles.amountDigits} pointerEvents="none">
                {!displayValue && (
                  <View
                    style={[
                      styles.caret,
                      { opacity: isFocused && caretOn ? 1 : 0 },
                    ]}
                  />
                )}
                <Text style={styles.amountText}>{displayValue || "0"}</Text>
                {!!displayValue && (
                  <View
                    style={[
                      styles.caret,
                      { opacity: isFocused && caretOn ? 1 : 0 },
                    ]}
                  />
                )}
              </View>
              <Text style={styles.amountSymbol} pointerEvents="none">
                {TOKEN_SYMBOL}
              </Text>
              <View style={styles.amountRowFiller} pointerEvents="none" />
              {/* Swap arrows — visual only per design instructions. */}
              <View
                style={styles.swapButton}
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <ArrowDownUp size={14} color="#FFF" strokeWidth={2.2} />
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
            <Text style={styles.amountUsd}>
              {USD_FORMATTER.format(usdValue)}
            </Text>
          </View>

          {/* Token selector pill — USDC dropdown is inert per design notes. */}
          <View style={styles.tokenPill}>
            <View style={styles.tokenPillInner}>
              <Image source={usdcLogo} style={styles.tokenLogo} />
              <Text style={styles.tokenSymbol}>{TOKEN_SYMBOL}</Text>
              <ChevronDown size={16} color="#1C1C1E" strokeWidth={2} />
            </View>
            <Text style={styles.tokenBalance}>
              {BALANCE_FORMATTER.format(TOKEN_BALANCE_USD)}
            </Text>
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
          <Pressable
            onPress={handleDeposit}
            accessibilityRole="button"
            accessibilityLabel="Deposit"
            disabled={depositDisabled}
            style={({ pressed }) => [
              styles.depositCta,
              depositDisabled && styles.depositCtaDisabled,
              !depositDisabled && pressed && styles.depositCtaPressed,
            ]}
          >
            <Text
              style={[
                styles.depositCtaLabel,
                depositDisabled && styles.depositCtaLabelDisabled,
              ]}
            >
              Deposit
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
    gap: 12,
  },
  amountSection: {
    paddingHorizontal: 8,
    gap: 4,
  },
  amountRow: {
    flexDirection: "row",
    // Bottom-align so the digit's baseline matches USDC's baseline. With
    // `alignItems: "center"` the larger font (48px) hangs lower than the
    // smaller one (32px) because their line-box centers align, not their
    // baselines. Pinning each Text's `lineHeight` to its `fontSize` makes
    // line-box-bottom ≈ baseline (no descenders in 0–9 / capitals), so
    // flex-end becomes baseline alignment in practice.
    alignItems: "flex-end",
    height: 56,
    gap: 8,
  },
  amountDigits: {
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
    // `opacity: 0` (not `color: "transparent"`) — on Android the latter
    // doesn't reliably hide BottomSheetTextInput's text rendering, which
    // double-draws the digit on top of the visible <Text>. Opacity 0 hides
    // the whole input while still receiving focus/keyboard.
    opacity: 0,
    padding: 0,
    fontSize: 48,
  },
  amountSymbol: {
    fontFamily: "Geist_600SemiBold",
    fontSize: 32,
    lineHeight: 32,
    color: COLOR_DIM,
    letterSpacing: 0.4,
    includeFontPadding: false,
  },
  footerAbsolute: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#FFF",
    paddingHorizontal: 32,
    paddingTop: 16,
  },
  amountRowFiller: {
    flex: 1,
  },
  swapButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLOR_BLACK,
    alignItems: "center",
    justifyContent: "center",
  },
  amountUsd: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 22,
    color: COLOR_LABEL_DIM,
  },
  tokenPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLOR_CHIP_BG,
    borderRadius: 26,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 12,
  },
  tokenPillInner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderRadius: 54,
    paddingLeft: 4,
    paddingRight: 6,
    paddingVertical: 4,
    gap: 6,
  },
  tokenLogo: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  tokenSymbol: {
    fontFamily: "Geist_500Medium",
    fontSize: 15,
    lineHeight: 20,
    color: COLOR_BLACK,
  },
  tokenBalance: {
    flex: 1,
    fontFamily: "Geist_500Medium",
    fontSize: 17,
    lineHeight: 22,
    color: COLOR_BLACK,
    letterSpacing: -0.187,
  },
  maxBadge: {
    minWidth: 64,
    backgroundColor: COLOR_BLACK,
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
    color: "#FFF",
  },
  depositCta: {
    height: 50,
    borderRadius: 78,
    backgroundColor: COLOR_BLACK,
    alignItems: "center",
    justifyContent: "center",
  },
  depositCtaPressed: {
    opacity: 0.85,
  },
  depositCtaDisabled: {
    backgroundColor: COLOR_DISABLED_BG,
  },
  depositCtaLabel: {
    fontFamily: "Geist_400Regular",
    fontSize: 17,
    lineHeight: 22,
    color: "#FFF",
  },
  depositCtaLabelDisabled: {
    color: COLOR_DISABLED_TEXT,
  },
});
