import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { ArrowLeft, ChevronDown, Search, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Linking, TextInput } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFixedSheetLayout } from "@/hooks/useFixedSheetLayout";
import { useKeyboardRescueFocus } from "@/hooks/useKeyboardRescueFocus";

import { useShield, type ShieldFeeEstimate } from "@/hooks/wallet/useShield";
import type { TokenDetailsByMint } from "@/hooks/wallet/useTokenDetails";
import { track } from "@/lib/analytics/analytics";
import { SHIELD_EVENTS } from "@/lib/analytics/shield-events";
import { NATIVE_SOL_MINT } from "@/lib/solana/constants";
import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import {
  buildShieldAssets,
  getShieldDirection,
  resolveInitialShieldAssetKey,
  type ShieldAsset,
  type ShieldDirection,
} from "@/lib/solana/shielding";
import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { Pressable, Text, View } from "@/tw";

import SwapCurrencyIcon from "../../../assets/images/icons/swap_currency_28.svg";
import SendErrorDog from "../../../assets/images/wallet/send_error_dog.svg";
import SendSpinnerIcon from "../../../assets/images/wallet/send_spinner_80.svg";
import SendSuccessDog from "../../../assets/images/wallet/send_success_dog.svg";
import ShieldEmblem from "../../../assets/images/wallet/shield_emblem.svg";
import ShieldOffEmblem from "../../../assets/images/wallet/shield_off_emblem.svg";

const shieldBadge = require("../../../assets/images/shield-badge.png");

// Fixed-height sheet (mirrors SendSheet/SwapSheet). A fixed height lets each
// step's flex-1 region size + center correctly and keeps the footer pinned.
// Height + snap point both come from useFixedSheetLayout so they can never
// diverge (screen-height math overshot the sheet on iPad/notched iPhones).
const LAMPORTS_PER_SOL_NUM = 1_000_000_000;

type ShieldStep = "form" | "confirm" | "result";

// ShieldAsset enriched with the live USD price (resolved from the matching
// holding) so the form/picker can show $ values without touching the lib type.
type ShieldAssetView = ShieldAsset & { priceUsd: number | null };

type ShieldSheetProps = {
  open: boolean;
  onClose: () => void;
  walletAddress: string | null;
  tokenHoldings: TokenHolding[];
  tokenDetailsByMint?: TokenDetailsByMint;
  onShieldComplete?: () => void;
  initialMint?: string;
  initialDirection?: ShieldDirection;
};

function getFriendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("insufficient lamports") || lower.includes("not enough sol"))
    return "You don't have enough SOL to complete this transaction.";
  if (lower.includes("insufficient funds"))
    return "Insufficient funds for this transaction.";
  if (lower.includes("user rejected")) return "Transaction was rejected.";
  if (lower.includes("blockhash not found") || lower.includes("block height exceeded"))
    return "The transaction expired. Please try again.";
  if (lower.includes("timeout") || lower.includes("timed out"))
    return "The transaction timed out. Please try again.";
  if (raw.length > 120) return "Something went wrong. Please try again.";
  return raw;
}

// Number formatting + amount-field helpers, mirrored from SendSheet/SwapSheet so
// the amount field behaves identically (thousands separators, mid-typing dot…).
function formatWithCommas(value: number, minFrac: number, maxFrac: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const [intPart, fracPartRaw = ""] = safe.toFixed(maxFrac).split(".");
  let fracPart = fracPartRaw;
  while (fracPart.length > minFrac && fracPart.endsWith("0")) {
    fracPart = fracPart.slice(0, -1);
  }
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fracPart ? `${withCommas}.${fracPart}` : withCommas;
}

function formatTokenAmount(value: number, minFrac = 2): string {
  return formatWithCommas(value, minFrac, 4);
}

function formatUsdAmount(value: number): string {
  return `$${formatWithCommas(value, 2, 2)}`;
}

function stripAmountInput(input: string): string {
  let cleaned = input.replace(/[^0-9.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length > 2) {
    cleaned = `${parts[0]}.${parts.slice(1).join("")}`;
  }
  const [intPart, decPart] = cleaned.split(".");
  const normalizedInt = intPart ? intPart.replace(/^0+(?=\d)/, "") : intPart;
  return decPart !== undefined
    ? `${normalizedInt || "0"}.${decPart}`
    : normalizedInt;
}

function formatAmountInputDisplay(raw: string): string {
  if (!raw) return "";
  const trailingDot = raw.endsWith(".") && !raw.slice(0, -1).includes(".");
  const [intPart, decPart] = raw.split(".");
  const intText = formatWithCommas(Number(intPart || "0"), 0, 0);
  if (trailingDot) return `${intText}.`;
  return decPart !== undefined ? `${intText}.${decPart}` : intText;
}

function formatFeeLamports(lamports: number): string {
  if (lamports <= 0) return "0 SOL";
  const sol = lamports / LAMPORTS_PER_SOL_NUM;
  if (sol < 0.00001) return "<0.00001 SOL";
  // Six significant-ish digits keep both rent-inflated and plain network
  // fees readable (rent can be 0.00204 SOL per account).
  return `${sol.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")} SOL`;
}

function getBalanceSourceLabel(isSecured: boolean): string {
  return isSecured ? "Shielded balance" : "Public balance";
}

function getOperationLabel(direction: ShieldDirection): string {
  return direction === "shield" ? "Shield" : "Unshield";
}

export function ShieldSheet({
  open,
  onClose,
  walletAddress,
  tokenHoldings,
  tokenDetailsByMint,
  onShieldComplete,
  initialMint,
  initialDirection,
}: ShieldSheetProps) {
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const { sheetHeight, snapPoints } = useFixedSheetLayout();
  const sheetSettledRef = useRef(false);
  const amountInputRef = useRef<TextInput | null>(null);
  const [step, setStep] = useState<ShieldStep>("form");
  const [showTokenPicker, setShowTokenPicker] = useState(false);
  const [selectedAssetKey, setSelectedAssetKey] = useState<string | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [currencyMode, setCurrencyMode] = useState<"TOKEN" | "USD">("USD");
  const [isMaxSelected, setIsMaxSelected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const [resultSuccess, setResultSuccess] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [feeEstimate, setFeeEstimate] = useState<ShieldFeeEstimate | null>(null);
  const [isEstimatingFee, setIsEstimatingFee] = useState(false);
  const feeRequestId = useRef(0);

  const { executeShield, executeUnshield, estimateFee } = useShield();

  const shieldAssets = useMemo(
    () => buildShieldAssets(tokenHoldings),
    [tokenHoldings],
  );

  // Resolve the live USD price for an asset from the matching holding.
  const priceFor = useCallback(
    (mint: string, isSecured: boolean): number | null =>
      tokenHoldings.find(
        (h) => h.mint === mint && Boolean(h.isSecured) === isSecured,
      )?.priceUsd ??
      tokenHoldings.find((h) => h.mint === mint)?.priceUsd ??
      null,
    [tokenHoldings],
  );

  const selectableAssets = useMemo<ShieldAssetView[]>(() => {
    const base = initialDirection
      ? shieldAssets.filter(
          (asset) => getShieldDirection(asset) === initialDirection,
        )
      : shieldAssets;
    return base.map((asset) => ({
      ...asset,
      priceUsd: priceFor(asset.mint, asset.isSecured),
    }));
  }, [initialDirection, shieldAssets, priceFor]);

  const selectedAsset = useMemo(
    () =>
      selectableAssets.find((asset) => asset.key === selectedAssetKey) ??
      selectableAssets[0] ??
      null,
    [selectedAssetKey, selectableAssets],
  );

  const direction = selectedAsset
    ? getShieldDirection(selectedAsset)
    : initialDirection ?? "shield";
  const selectedAssetMint = selectedAsset?.mint ?? NATIVE_SOL_MINT;
  const selectedAssetIcon = resolveTokenIcon({
    mint: selectedAssetMint,
    imageUrl: selectedAsset?.imageUrl ?? null,
    detailLogoUrl: tokenDetailsByMint?.[selectedAssetMint]?.token.logoUrl,
  });
  const price = selectedAsset?.priceUsd ?? null;
  const sourceBalance = selectedAsset?.balance ?? 0;

  // `amountStr` is the value typed in the active denomination; the executed
  // amount and every check operate on the token amount, so derive it here.
  // Fall back to TOKEN entry when the asset has no USD price (USD mode would
  // have nothing to convert against and would pin the amount to 0).
  const effectiveMode = price ? currencyMode : "TOKEN";
  const amountInput = parseFloat(amountStr) || 0;
  const amountNum =
    effectiveMode === "USD"
      ? price && price > 0
        ? amountInput / price
        : 0
      : amountInput;
  const isValidAmount =
    Boolean(selectedAsset) && amountNum > 0 && amountNum <= sourceBalance;
  const isFormValid = isValidAmount;

  // Reset state on open/close transitions only. Re-running on shieldAssets
  // change would clobber the result step after onShieldComplete refreshes
  // holdings.
  useEffect(() => {
    if (open) {
      bottomSheetRef.current?.present();
      setStep("form");
      setShowTokenPicker(false);
      setSelectedAssetKey(
        resolveInitialShieldAssetKey(shieldAssets, {
          initialMint,
          initialDirection,
        }),
      );
      setAmountStr("");
      setCurrencyMode("USD");
      setIsMaxSelected(false);
      setResultError(null);
      setResultSuccess(false);
      setTxSignature(null);
      setIsProcessing(false);
      setFeeEstimate(null);
      setIsEstimatingFee(false);
    } else {
      bottomSheetRef.current?.dismiss();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep a valid selection when the available assets change.
  useEffect(() => {
    if (!open) return;
    if (
      !selectedAssetKey ||
      !selectableAssets.some((asset) => asset.key === selectedAssetKey)
    ) {
      setSelectedAssetKey(
        resolveInitialShieldAssetKey(shieldAssets, {
          initialMint,
          initialDirection,
        }),
      );
    }
  }, [
    initialDirection,
    initialMint,
    open,
    selectableAssets,
    selectedAssetKey,
    shieldAssets,
  ]);

  // Kick off the fee estimate as soon as the amount is valid so it's resolved
  // by the time the user reaches confirm; it survives form ↔ confirm ↔ result
  // and is only invalidated when the sheet closes or the inputs change.
  useEffect(() => {
    if (!open || !selectedAsset || !isValidAmount) {
      setFeeEstimate(null);
      setIsEstimatingFee(false);
      return;
    }
    const requestId = ++feeRequestId.current;
    setIsEstimatingFee(true);
    setFeeEstimate(null);
    const timer = setTimeout(() => {
      estimateFee({
        direction,
        tokenSymbol: selectedAsset.symbol,
        amount: amountNum,
        tokenMint: selectedAsset.mint,
        tokenDecimals: selectedAsset.decimals,
        isMax: isMaxSelected,
      })
        .then((estimate) => {
          if (feeRequestId.current !== requestId) return;
          setFeeEstimate(estimate);
          setIsEstimatingFee(false);
        })
        .catch(() => {
          if (feeRequestId.current !== requestId) return;
          setFeeEstimate(null);
          setIsEstimatingFee(false);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [
    open,
    isValidAmount,
    selectedAsset,
    amountNum,
    direction,
    estimateFee,
    isMaxSelected,
  ]);

  // Focus the amount input once the sheet has settled at its snap point.
  const focusActiveInput = useCallback(() => {
    if (step === "form" && !showTokenPicker) {
      amountInputRef.current?.focus();
    }
  }, [step, showTokenPicker]);

  const handleSheetChange = useCallback(
    (index: number) => {
      sheetSettledRef.current = index >= 0;
      if (index >= 0) {
        setTimeout(focusActiveInput, 120);
      }
    },
    [focusActiveInput],
  );

  useEffect(() => {
    if (!sheetSettledRef.current) return;
    const id = setTimeout(focusActiveInput, 80);
    return () => clearTimeout(id);
  }, [focusActiveInput]);

  const handleConfirm = useCallback(async () => {
    if (!isFormValid || isProcessing || !walletAddress || !selectedAsset) return;

    Keyboard.dismiss();
    setIsProcessing(true);
    setResultError(null);
    setResultSuccess(false);
    setTxSignature(null);
    setStep("result");

    try {
      const params = {
        tokenSymbol: selectedAsset.symbol,
        amount: amountNum,
        tokenMint: selectedAsset.mint,
        tokenDecimals: selectedAsset.decimals,
        isMax: isMaxSelected,
      };

      const result =
        direction === "shield"
          ? await executeShield(params)
          : await executeUnshield(params);

      if (result.success) {
        setResultSuccess(true);
        setTxSignature(result.signature ?? null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        track(
          direction === "shield"
            ? SHIELD_EVENTS.shieldTokens
            : SHIELD_EVENTS.unshieldTokens,
        );
        onShieldComplete?.();
      } else {
        setResultError(getFriendlyError(result.error ?? "Transaction failed"));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        track(
          direction === "shield"
            ? SHIELD_EVENTS.shieldTokensFailed
            : SHIELD_EVENTS.unshieldTokensFailed,
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Transaction failed";
      setResultError(getFriendlyError(msg));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      track(
        direction === "shield"
          ? SHIELD_EVENTS.shieldTokensFailed
          : SHIELD_EVENTS.unshieldTokensFailed,
      );
    } finally {
      setIsProcessing(false);
    }
  }, [
    amountNum,
    direction,
    executeShield,
    executeUnshield,
    isFormValid,
    isMaxSelected,
    isProcessing,
    onShieldComplete,
    selectedAsset,
    walletAddress,
  ]);

  const handleClose = useCallback(() => {
    bottomSheetRef.current?.dismiss();
  }, []);

  const handleAmountChange = useCallback((value: string) => {
    setAmountStr(stripAmountInput(value));
    setIsMaxSelected(false);
  }, []);

  const toggleCurrency = useCallback(() => {
    if (!price) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currencyMode === "TOKEN") {
      const usd = amountNum * price;
      setCurrencyMode("USD");
      setAmountStr(usd > 0 ? usd.toFixed(2) : "");
    } else {
      setCurrencyMode("TOKEN");
      setAmountStr(amountNum > 0 ? String(Number(amountNum.toFixed(6))) : "");
    }
  }, [currencyMode, amountNum, price]);

  const handleMax = useCallback(() => {
    if (!selectedAsset) return;
    let val = sourceBalance;
    // Reserve the network fee when maxing out SOL so the shield never leaves
    // the wallet without lamports for fees. (For unshield the raw on-chain
    // amount is used, so the reserve here doesn't affect the drain.)
    if (selectedAsset.mint === NATIVE_SOL_MINT && sourceBalance - val < 0.00005) {
      val = Math.max(0, sourceBalance - 0.00005);
    }
    // Truncate (never round) so float rounding can't push past the balance.
    const truncated = Math.floor(val * 1e6) / 1e6;
    if (truncated <= 0) {
      setAmountStr("");
      setIsMaxSelected(false);
      return;
    }
    setIsMaxSelected(true);
    if (currencyMode === "USD" && price && price > 0) {
      setAmountStr((truncated * price).toFixed(2));
    } else {
      setAmountStr(String(truncated));
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [selectedAsset, sourceBalance, currencyMode, price]);

  const handleSelectAsset = useCallback((assetKey: string) => {
    setSelectedAssetKey(assetKey);
    setAmountStr("");
    setCurrencyMode("USD");
    setIsMaxSelected(false);
    setShowTokenPicker(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

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

  const showForm = step === "form" && !showTokenPicker;

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose={step !== "result" || !isProcessing}
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
      onChange={handleSheetChange}
      handleComponent={null}
      backgroundStyle={{ borderTopLeftRadius: 38, borderTopRightRadius: 38 }}
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetView
        style={{
          height: sheetHeight,
          backgroundColor: "#fff",
          borderTopLeftRadius: 38,
          borderTopRightRadius: 38,
          overflow: "hidden",
        }}
      >
        {showForm && (
          <FormStep
            direction={direction}
            selectedAsset={selectedAsset}
            selectedAssetIcon={selectedAssetIcon}
            amountStr={amountStr}
            onAmountChange={handleAmountChange}
            currencyMode={effectiveMode}
            onToggleCurrency={toggleCurrency}
            price={price}
            amountNum={amountNum}
            sourceBalance={sourceBalance}
            onMax={handleMax}
            onOpenTokenPicker={() => {
              Keyboard.dismiss();
              setShowTokenPicker(true);
            }}
            isFormValid={isFormValid}
            onReview={() => {
              Keyboard.dismiss();
              setStep("confirm");
            }}
            onClose={handleClose}
            amountInputRef={amountInputRef}
          />
        )}

        {step === "form" && showTokenPicker && (
          <BottomSheetScrollView
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            <TokenPicker
              assets={selectableAssets}
              tokenDetailsByMint={tokenDetailsByMint}
              onSelect={handleSelectAsset}
              onBack={() => setShowTokenPicker(false)}
            />
          </BottomSheetScrollView>
        )}

        {step === "confirm" && (
          <ConfirmStep
            direction={direction}
            selectedAsset={selectedAsset}
            selectedAssetIcon={selectedAssetIcon}
            amountNum={amountNum}
            price={price}
            feeEstimate={feeEstimate}
            isEstimatingFee={isEstimatingFee}
            isProcessing={isProcessing}
            onConfirm={handleConfirm}
            onBack={() => setStep("form")}
          />
        )}

        {step === "result" && (
          <ResultStep
            direction={direction}
            isProcessing={isProcessing}
            resultError={resultError}
            resultSuccess={resultSuccess}
            amountNum={amountNum}
            selectedAsset={selectedAsset}
            txSignature={txSignature}
            onDone={handleClose}
          />
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
}

// Shared toolbar header (circular control on the left, centered title).
function SheetHeader({
  title,
  onLeftPress,
  variant,
}: {
  title: string;
  onLeftPress: () => void;
  variant: "close" | "back";
}) {
  return (
    <View style={{ paddingVertical: 16 }}>
      <View className="flex-row items-center justify-between px-4">
        <Pressable
          className="h-11 w-11 items-center justify-center rounded-full bg-[#f2f2f7]"
          hitSlop={6}
          onPress={onLeftPress}
          accessibilityRole="button"
          accessibilityLabel={variant === "close" ? "Close" : "Back"}
        >
          {variant === "close" ? (
            <X size={24} color="rgba(60,60,67,0.6)" strokeWidth={2} />
          ) : (
            <ArrowLeft size={24} color="rgba(60,60,67,0.6)" strokeWidth={2} />
          )}
        </Pressable>
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <Text
            className="text-[17px] font-semibold text-black"
            style={{ lineHeight: 22 }}
          >
            {title}
          </Text>
        </View>
        <View className="h-11 w-11" style={{ opacity: 0 }} />
      </View>
    </View>
  );
}

// --- Form Step ---
function FormStep({
  direction,
  selectedAsset,
  selectedAssetIcon,
  amountStr,
  onAmountChange,
  currencyMode,
  onToggleCurrency,
  price,
  amountNum,
  sourceBalance,
  onMax,
  onOpenTokenPicker,
  isFormValid,
  onReview,
  onClose,
  amountInputRef,
}: {
  direction: ShieldDirection;
  selectedAsset: ShieldAssetView | null;
  selectedAssetIcon: string;
  amountStr: string;
  onAmountChange: (v: string) => void;
  currencyMode: "TOKEN" | "USD";
  onToggleCurrency: () => void;
  price: number | null;
  amountNum: number;
  sourceBalance: number;
  onMax: () => void;
  onOpenTokenPicker: () => void;
  isFormValid: boolean;
  onReview: () => void;
  onClose: () => void;
  amountInputRef: React.RefObject<TextInput | null>;
}) {
  const { openKeyboard } = useKeyboardRescueFocus(amountInputRef);
  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard();
  const footerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboard.height.value }],
  }));

  // Custom blinking caret (the real input is a transparent overlay).
  const [isFocused, setIsFocused] = useState(false);
  const [caretOn, setCaretOn] = useState(true);
  useEffect(() => {
    if (!isFocused) {
      setCaretOn(true);
      return;
    }
    const id = setInterval(() => setCaretOn((v) => !v), 530);
    return () => clearInterval(id);
  }, [isFocused]);

  const symbol = selectedAsset?.symbol ?? "";
  const display = formatAmountInputDisplay(amountStr) || "0";
  const bigText = currencyMode === "USD" ? `$${display}` : display;
  const subText =
    currencyMode === "USD"
      ? `${formatTokenAmount(amountNum)} ${symbol}`
      : formatUsdAmount(price ? amountNum * price : 0);

  const balanceTop =
    price != null
      ? formatUsdAmount(sourceBalance * price)
      : `${formatTokenAmount(sourceBalance)} ${symbol}`;
  const balanceSub = `${formatTokenAmount(sourceBalance)} ${symbol}`;

  // CTA state — no amount → dim "Enter amount" (translucent-black fill so the
  // label stays crisp white); over balance → light-red "Insufficient balance";
  // valid → solid-black "Review".
  const hasAmount = amountNum > 0;
  const overBalance = hasAmount && amountNum > sourceBalance;
  let ctaLabel = "Enter amount";
  let ctaBg = "rgba(0,0,0,0.24)";
  let ctaTextColor = "#fff";
  let ctaDisabled = true;
  if (overBalance) {
    ctaLabel = "Insufficient balance";
    ctaBg = "rgba(249,54,60,0.14)";
    ctaTextColor = "#f9363c";
  } else if (hasAmount && isFormValid) {
    ctaLabel = "Review";
    ctaBg = "#000";
    ctaDisabled = false;
  } else if (hasAmount) {
    ctaLabel = "Review";
  }

  if (!selectedAsset) {
    return (
      <View style={{ flex: 1 }}>
        <SheetHeader
          title={getOperationLabel(direction)}
          onLeftPress={onClose}
          variant="close"
        />
        <View className="flex-1 items-center justify-center px-8">
          <Text
            className="text-[15px]"
            style={{ color: "rgba(60,60,67,0.6)", textAlign: "center" }}
          >
            {direction === "shield"
              ? "No public balances are available to shield right now."
              : "No shielded balances are available to unshield right now."}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <SheetHeader
        title={getOperationLabel(direction)}
        onLeftPress={onClose}
        variant="close"
      />

      {/* Amount */}
      <View style={{ paddingHorizontal: 16, paddingTop: 36 }}>
        <View className="flex-row items-center" style={{ height: 58 }}>
          <Pressable
            style={{ flex: 1, position: "relative", justifyContent: "center" }}
            onPress={openKeyboard}
          >
            <View
              className="flex-row items-center"
              style={{ maxWidth: "100%" }}
              pointerEvents="none"
            >
              <Text
                className="font-semibold text-black"
                // 58pt line box: iOS clips ascenders at lineHeight == fontSize.
                style={{ fontSize: 48, lineHeight: 58, flexShrink: 1 }}
                numberOfLines={1}
              >
                {bigText}
              </Text>
              <View
                style={{
                  width: 2,
                  height: 44,
                  marginLeft: 2,
                  borderRadius: 1,
                  backgroundColor: "#000",
                  opacity: isFocused && caretOn ? 1 : 0,
                }}
              />
            </View>
            <BottomSheetTextInput
              ref={amountInputRef as unknown as React.Ref<never>}
              value={amountStr}
              onChangeText={onAmountChange}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              keyboardType="decimal-pad"
              inputMode="decimal"
              maxLength={15}
              caretHidden
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                opacity: 0,
                padding: 0,
                fontSize: 48,
              }}
              accessibilityLabel={`${getOperationLabel(direction)} amount`}
            />
          </Pressable>
          {price ? (
            <Pressable
              onPress={onToggleCurrency}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Switch between token and USD"
              style={{
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <SwapCurrencyIcon width={28} height={28} />
            </Pressable>
          ) : null}
        </View>
        <Text
          className="text-[15px] font-normal"
          style={{ color: "rgba(60,60,67,0.6)", lineHeight: 20, marginTop: 4 }}
        >
          {subText}
        </Text>
      </View>

      <View style={{ flex: 1 }} />

      {/* Footer: balance selector + CTA — rides up with the keyboard. */}
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "#fff",
          },
          footerStyle,
        ]}
      >
        {/* Balance selector cell */}
        <View
          className="flex-row items-center"
          style={{ paddingHorizontal: 16 }}
        >
          <Pressable
            onPress={onOpenTokenPicker}
            accessibilityRole="button"
            accessibilityLabel="Change token"
            className="flex-row items-center"
            style={{
              backgroundColor: "rgba(0,0,0,0.04)",
              borderRadius: 61,
              padding: 4,
              marginRight: 12,
            }}
          >
            <View style={{ position: "relative" }}>
              <Image
                source={{ uri: selectedAssetIcon }}
                style={{ width: 40, height: 40, borderRadius: 20 }}
              />
              {selectedAsset.isSecured ? (
                <Image
                  source={shieldBadge}
                  style={{
                    position: "absolute",
                    bottom: -2,
                    right: -2,
                    width: 16,
                    height: 16,
                  }}
                />
              ) : null}
            </View>
            <View style={{ width: 24, alignItems: "center" }}>
              <ChevronDown size={16} color="rgba(60,60,67,0.3)" strokeWidth={2.5} />
            </View>
          </Pressable>
          <View className="flex-1" style={{ paddingVertical: 8 }}>
            <Text
              className="text-[20px] font-semibold text-black"
              style={{ lineHeight: 24 }}
              numberOfLines={1}
            >
              {balanceTop}
            </Text>
            <Text
              className="text-[15px] font-normal"
              style={{ color: "rgba(60,60,67,0.6)", lineHeight: 20 }}
              numberOfLines={1}
            >
              {balanceSub}
            </Text>
          </View>
          <Pressable
            onPress={onMax}
            accessibilityRole="button"
            accessibilityLabel="Use max balance"
            className="items-center justify-center"
            style={{
              backgroundColor: "rgba(0,0,0,0.04)",
              borderRadius: 40,
              minWidth: 64,
              paddingHorizontal: 16,
              paddingVertical: 8,
              marginLeft: 12,
            }}
          >
            <Text
              className="text-[15px] font-medium text-black"
              style={{ lineHeight: 20 }}
            >
              MAX
            </Text>
          </Pressable>
        </View>

        {/* CTA */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 16,
            paddingBottom: insets.bottom + 12,
          }}
        >
          <Pressable
            className="items-center justify-center"
            style={{ height: 50, borderRadius: 78, backgroundColor: ctaBg }}
            onPress={ctaDisabled ? undefined : onReview}
            disabled={ctaDisabled}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
          >
            <Text
              className="text-[16px] font-medium"
              style={{ lineHeight: 20, color: ctaTextColor }}
            >
              {ctaLabel}
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

// --- Token Picker ("Select asset") ---
function TokenPicker({
  assets,
  tokenDetailsByMint,
  onSelect,
  onBack,
}: {
  assets: ShieldAssetView[];
  tokenDetailsByMint?: TokenDetailsByMint;
  onSelect: (assetKey: string) => void;
  onBack: () => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return assets;
    const lower = search.toLowerCase();
    return assets.filter(
      (a) =>
        a.symbol.toLowerCase().includes(lower) ||
        a.name.toLowerCase().includes(lower) ||
        a.mint.toLowerCase().includes(lower),
    );
  }, [assets, search]);

  return (
    <View className="w-full">
      {/* Toolbar */}
      <View className="w-full" style={{ paddingVertical: 16 }}>
        <View className="flex-row items-center justify-between px-4">
          <Pressable
            className="h-11 w-11 items-center justify-center rounded-full bg-[#f2f2f7]"
            hitSlop={6}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <ArrowLeft size={24} color="rgba(60,60,67,0.6)" strokeWidth={2} />
          </Pressable>
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <Text
              className="text-[17px] font-semibold text-black"
              style={{ lineHeight: 22 }}
            >
              Select asset
            </Text>
          </View>
          <View className="h-11 w-11" style={{ opacity: 0 }} />
        </View>
      </View>

      {/* Search */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
        <View
          className="flex-row items-center"
          style={{ backgroundColor: "#f2f2f7", borderRadius: 47, paddingHorizontal: 16 }}
        >
          <View style={{ paddingRight: 12, paddingVertical: 14 }}>
            <Search size={24} color="rgba(60,60,67,0.6)" strokeWidth={2} />
          </View>
          <BottomSheetTextInput
            style={{
              flex: 1,
              paddingVertical: 15,
              fontFamily: "Geist_400Regular",
              fontSize: 17,
              color: "#000",
            }}
            placeholder="Search"
            placeholderTextColor="rgba(60,60,67,0.6)"
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      {/* Rows */}
      {filtered.map((asset) => {
        const icon = resolveTokenIcon({
          mint: asset.mint,
          imageUrl: asset.imageUrl,
          detailLogoUrl: tokenDetailsByMint?.[asset.mint]?.token.logoUrl,
        });
        return (
          <Pressable
            key={asset.key}
            className="w-full flex-row items-center"
            style={{ paddingHorizontal: 16 }}
            onPress={() => onSelect(asset.key)}
            accessibilityRole="button"
            accessibilityLabel={`Select ${asset.name}`}
          >
            <View style={{ paddingRight: 12, paddingVertical: 6 }}>
              <View style={{ position: "relative" }}>
                <Image
                  source={{ uri: icon }}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    borderWidth: 0.5,
                    borderColor: "rgba(0,0,0,0.08)",
                  }}
                />
                {asset.isSecured ? (
                  <Image
                    source={shieldBadge}
                    style={{
                      position: "absolute",
                      bottom: -2,
                      right: -2,
                      width: 16,
                      height: 16,
                    }}
                  />
                ) : null}
              </View>
            </View>
            <View className="flex-1" style={{ paddingVertical: 8, gap: 2 }}>
              <Text
                className="text-[17px] font-medium text-black"
                style={{ lineHeight: 22, letterSpacing: -0.187 }}
                numberOfLines={1}
              >
                {asset.name}
                {asset.isSecured ? " · Shielded" : ""}
              </Text>
              <Text
                className="text-[15px] font-normal"
                style={{ color: "rgba(60,60,67,0.6)", lineHeight: 20 }}
                numberOfLines={1}
              >
                {formatTokenAmount(asset.balance)} {asset.symbol}
              </Text>
            </View>
            <View style={{ paddingLeft: 12 }}>
              <Text
                className="text-[17px] font-medium text-black"
                style={{ lineHeight: 22 }}
              >
                {formatUsdAmount(asset.balance * (asset.priceUsd ?? 0))}
              </Text>
            </View>
          </Pressable>
        );
      })}

      {filtered.length === 0 ? (
        <Text
          className="text-[15px] font-normal"
          style={{
            color: "rgba(60,60,67,0.6)",
            textAlign: "center",
            paddingVertical: 32,
          }}
        >
          No tokens found
        </Text>
      ) : null}
    </View>
  );
}

// --- Confirm Step ---
function ConfirmStep({
  direction,
  selectedAsset,
  selectedAssetIcon,
  amountNum,
  price,
  feeEstimate,
  isEstimatingFee,
  isProcessing,
  onConfirm,
  onBack,
}: {
  direction: ShieldDirection;
  selectedAsset: ShieldAssetView | null;
  selectedAssetIcon: string;
  amountNum: number;
  price: number | null;
  feeEstimate: ShieldFeeEstimate | null;
  isEstimatingFee: boolean;
  isProcessing: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const symbol = selectedAsset?.symbol ?? "";
  const usd = price != null ? amountNum * price : null;
  const feeValue = isEstimatingFee
    ? "Estimating…"
    : feeEstimate
      ? formatFeeLamports(feeEstimate.totalLamports)
      : "—";
  const fromLabel = getBalanceSourceLabel(direction === "unshield");
  const toLabel = getBalanceSourceLabel(direction === "shield");

  return (
    <View style={{ flex: 1 }}>
      <SheetHeader
        title={getOperationLabel(direction)}
        onLeftPress={onBack}
        variant="back"
      />

      {/* Token + operation emblem */}
      <View style={{ padding: 16 }}>
        <View style={{ width: 64, height: 64 }}>
          <Image
            source={{ uri: selectedAssetIcon }}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              width: 42.667,
              height: 42.667,
              borderRadius: 21.333,
            }}
          />
          <View
            style={{ position: "absolute", right: 0, bottom: 0, width: 42.667, height: 42.667 }}
          >
            {direction === "shield" ? (
              <ShieldEmblem width={42.667} height={42.667} />
            ) : (
              <ShieldOffEmblem width={42.667} height={42.667} />
            )}
          </View>
        </View>
      </View>

      {/* Amount */}
      <View style={{ paddingHorizontal: 24, paddingBottom: 20, gap: 4 }}>
        <View className="flex-row items-baseline" style={{ gap: 8 }}>
          <Text
            className="font-semibold text-black"
            style={{ fontSize: 40, lineHeight: 48 }}
          >
            {formatTokenAmount(amountNum, 0)}
          </Text>
          <Text
            className="font-semibold"
            style={{ fontSize: 28, color: "rgba(60,60,67,0.4)" }}
          >
            {symbol}
          </Text>
        </View>
        {usd != null ? (
          <Text
            className="text-[17px] font-normal"
            style={{ color: "rgba(60,60,67,0.6)", lineHeight: 22 }}
          >
            ≈{formatUsdAmount(usd)}
          </Text>
        ) : null}
      </View>

      {/* Detail card */}
      <View style={{ paddingHorizontal: 16 }}>
        <View style={{ backgroundColor: "#f2f2f7", borderRadius: 20, paddingVertical: 4 }}>
          <ConfirmRow label="Network Fee">
            <Text className="text-[17px] text-black" style={{ lineHeight: 22 }}>
              {feeValue}
            </Text>
            {feeEstimate && feeEstimate.totalLamports > 0 ? (
              <Text
                className="text-[17px]"
                style={{ color: "rgba(60,60,67,0.6)", lineHeight: 22 }}
              >
                {"  <$0.01"}
              </Text>
            ) : null}
          </ConfirmRow>
          <ConfirmRow label="From">
            <Text className="text-[17px] text-black" style={{ lineHeight: 22 }}>
              {fromLabel}
            </Text>
          </ConfirmRow>
          <ConfirmRow label="To">
            <Text className="text-[17px] text-black" style={{ lineHeight: 22 }}>
              {toLabel}
            </Text>
          </ConfirmRow>
        </View>
      </View>

      <View style={{ flex: 1 }} />

      {/* Footer */}
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: insets.bottom + 12,
        }}
      >
        <Pressable
          className="items-center justify-center"
          style={{
            height: 50,
            borderRadius: 78,
            backgroundColor: "#000",
            opacity: isProcessing ? 0.4 : 1,
          }}
          onPress={onConfirm}
          disabled={isProcessing}
          accessibilityRole="button"
          accessibilityLabel={`Confirm and ${getOperationLabel(direction)}`}
        >
          <Text
            className="text-[16px] font-medium text-white"
            style={{ lineHeight: 20 }}
          >
            Confirm and {getOperationLabel(direction)}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function ConfirmRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ paddingHorizontal: 16 }}>
      <View style={{ paddingVertical: 10 }}>
        <Text
          className="text-[14px] font-normal"
          style={{ color: "rgba(60,60,67,0.6)", lineHeight: 18 }}
        >
          {label}
        </Text>
        <View className="flex-row items-center">{children}</View>
      </View>
    </View>
  );
}

// Continuously rotating red spinner arc, shown while the tx is in flight.
function ProcessingSpinner() {
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 900, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(rotation);
  }, [rotation]);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));
  return (
    <Animated.View style={[{ width: 80, height: 80 }, style]}>
      <SendSpinnerIcon width={80} height={80} />
    </Animated.View>
  );
}

// Mascot entrance: rapid zoom-in with a spring overshoot (bounce) + fade-in.
function MascotReveal({ children }: { children: React.ReactNode }) {
  const scale = useSharedValue(0.3);
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withTiming(1, {
      duration: 160,
      easing: Easing.out(Easing.quad),
    });
    scale.value = withSpring(1, { damping: 8, stiffness: 220, mass: 0.6 });
    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
    };
  }, [scale, opacity]);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

// --- Result Step ---
function ResultStep({
  direction,
  isProcessing,
  resultError,
  resultSuccess,
  amountNum,
  selectedAsset,
  txSignature,
  onDone,
}: {
  direction: ShieldDirection;
  isProcessing: boolean;
  resultError: string | null;
  resultSuccess: boolean;
  amountNum: number;
  selectedAsset: ShieldAssetView | null;
  txSignature: string | null;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const status = isProcessing ? "processing" : resultError ? "error" : "success";
  const symbol = selectedAsset?.symbol ?? "tokens";

  const explorerUrl = txSignature
    ? `https://solscan.io/tx/${txSignature}${
        getSolanaEnv() === "mainnet" ? "" : `?cluster=${getSolanaEnv()}`
      }`
    : null;

  const title =
    status === "processing"
      ? direction === "shield"
        ? "Shielding…"
        : "Unshielding…"
      : status === "success"
        ? direction === "shield"
          ? "Shielded"
          : "Unshielded"
        : "Transaction failed";

  return (
    <View className="w-full" style={{ flex: 1 }}>
      <SheetHeader
        title={getOperationLabel(direction)}
        onLeftPress={onDone}
        variant="close"
      />

      {/* Centered status */}
      <View
        className="flex-1 items-center justify-center"
        style={{ paddingHorizontal: 32, paddingVertical: 24 }}
      >
        <View className="w-full items-center" style={{ gap: 20 }}>
          {status === "processing" ? (
            <ProcessingSpinner />
          ) : status === "success" ? (
            <MascotReveal>
              <SendSuccessDog width={100} height={80} />
            </MascotReveal>
          ) : (
            <MascotReveal>
              <SendErrorDog width={100} height={80} />
            </MascotReveal>
          )}

          <View className="w-full items-center" style={{ gap: 4 }}>
            <Text
              className="text-[22px] font-semibold text-black"
              style={{ lineHeight: 28, textAlign: "center" }}
            >
              {title}
            </Text>
            {status === "success" ? (
              <Text
                className="text-[17px] font-normal"
                style={{ lineHeight: 22, textAlign: "center", maxWidth: 300 }}
              >
                <Text className="text-black">
                  {formatTokenAmount(amountNum, 0)} {symbol}
                </Text>
                <Text style={{ color: "rgba(60,60,67,0.6)" }}>
                  {direction === "shield"
                    ? " moved to your shielded balance"
                    : " moved to your public balance"}
                </Text>
              </Text>
            ) : (
              <Text
                className="text-[17px] font-normal"
                style={{
                  color: "rgba(60,60,67,0.6)",
                  lineHeight: 22,
                  textAlign: "center",
                  maxWidth: 300,
                }}
              >
                {status === "processing"
                  ? "You can close this screen and continue using the app"
                  : (resultError ?? "Something went wrong. Please try again.")}
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Footer */}
      <View
        style={{
          backgroundColor: "#fff",
          paddingTop: 16,
          paddingBottom: insets.bottom + 12,
          paddingHorizontal: 20,
          gap: 10,
        }}
      >
        <Pressable
          className="items-center justify-center"
          style={{ height: 50, borderRadius: 78, backgroundColor: "#000" }}
          onPress={onDone}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text
            className="text-[16px] font-medium text-white"
            style={{ lineHeight: 20 }}
          >
            Done
          </Text>
        </Pressable>
        {explorerUrl ? (
          <Pressable
            className="items-center justify-center"
            style={{ height: 50, borderRadius: 78, backgroundColor: "#f5f5f5" }}
            onPress={() => Linking.openURL(explorerUrl)}
            accessibilityRole="button"
            accessibilityLabel="View transaction"
          >
            <Text
              className="text-[17px] font-medium text-black"
              style={{ lineHeight: 22 }}
            >
              View transaction
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
