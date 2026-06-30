import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { VersionedTransaction } from "@solana/web3.js";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import {
  ArrowLeft,
  ArrowUpDown,
  ChevronRight,
  Search,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  Linking,
  TextInput,
} from "react-native";
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

import type { PopularToken } from "@/hooks/wallet/usePopularTokens";
import { usePopularTokens } from "@/hooks/wallet/usePopularTokens";
import { useShield } from "@/hooks/wallet/useShield";
import { track } from "@/lib/analytics/analytics";
import { SWAP_EVENTS } from "@/lib/analytics/swap-events";
import {
  NATIVE_SOL_MINT,
  SOL_PRICE_USD,
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDC_MINT_MAINNET,
} from "@/lib/solana/constants";
import {
  estimateJupiterSwapFeeState,
  getJupiterQuote,
  getJupiterSwapTransaction,
  type JupiterQuoteResponse,
  type SwapFeeEstimateState,
} from "@/lib/solana/jupiter";
import { getConnection, getSolanaEnv } from "@/lib/solana/rpc/connection";
import { DEFAULT_TOKEN_ICON } from "@/lib/solana/token-holdings/constants";
import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import type { TokenDetailsByMint } from "@/hooks/wallet/useTokenDetails";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, Text, View } from "@/tw";

import SwapCurrencyIcon from "../../../assets/images/icons/swap_currency_28.svg";
import SendErrorDog from "../../../assets/images/wallet/send_error_dog.svg";
import SendSpinnerIcon from "../../../assets/images/wallet/send_spinner_80.svg";
import SendSuccessDog from "../../../assets/images/wallet/send_success_dog.svg";

const shieldBadge = require("../../../assets/images/shield-badge.png");

// Fixed-height sheet (mirrors SendSheet). A fixed height is what lets each
// step's `flex-1` regions size + center correctly and keeps the footer pinned.
const SCREEN_HEIGHT = Dimensions.get("screen").height;
const SHEET_HEIGHT = Math.floor(SCREEN_HEIGHT * 0.94);
const SWAP_SNAP_POINTS = ["94%"];
const DEFAULT_SOL_MAX_FEE_RESERVE_LAMPORTS = 50_000;

type SwapStep = "form" | "confirm" | "result";

type SwapSheetProps = {
  open: boolean;
  onClose: () => void;
  walletAddress: string | null;
  tokenHoldings: TokenHolding[];
  tokenDetailsByMint?: TokenDetailsByMint;
  onSwapComplete?: () => void;
  initialFromMint?: string;
  initialToMint?: string;
};

const getDefaultUsdcMint = (): string => {
  const env = getSolanaEnv();
  return env === "mainnet" ? SOLANA_USDC_MINT_MAINNET : SOLANA_USDC_MINT_DEVNET;
};

const getTokenIcon = (
  holding: TokenHolding,
  detailLogoUrl?: string | null
): string =>
  resolveTokenIcon({
    mint: holding.mint,
    imageUrl: holding.imageUrl,
    detailLogoUrl,
  });

function getFriendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes("insufficient lamports") ||
    lower.includes("not enough sol")
  )
    return "You don't have enough SOL to complete this swap.";
  if (lower.includes("insufficient funds"))
    return "Insufficient funds for this swap.";
  if (lower.includes("slippage") || lower.includes("exceeds"))
    return "Price moved too much. Try increasing slippage or retry.";
  if (
    lower.includes("blockhash not found") ||
    lower.includes("block height exceeded")
  )
    return "The transaction expired. Please try again.";
  if (lower.includes("timeout") || lower.includes("timed out"))
    return "The transaction timed out. Please try again.";
  if (raw.length > 120) return "Something went wrong. Please try again.";
  return raw;
}

// Number formatting + amount-field helpers, mirrored from SendSheet so the Swap
// amount field behaves identically (thousands separators, mid-typing dot, etc.).
function formatWithCommas(
  value: number,
  minFrac: number,
  maxFrac: number
): string {
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

function formatSolAmount(value: number): string {
  return formatWithCommas(value, 0, 6);
}

function formatLamportsAsSol(lamports: number): string {
  return formatSolAmount(lamports / 1_000_000_000);
}

function getFeeSolPriceUsd(
  holdings: (TokenHolding | null | undefined)[]
): number | null {
  const solHolding = holdings.find(
    (holding) =>
      holding &&
      (holding.symbol.toUpperCase() === "SOL" ||
        holding.mint === NATIVE_SOL_MINT)
  );
  if (
    typeof solHolding?.priceUsd === "number" &&
    Number.isFinite(solHolding.priceUsd) &&
    solHolding.priceUsd > 0
  ) {
    return solHolding.priceUsd;
  }
  return Number.isFinite(SOL_PRICE_USD) && SOL_PRICE_USD > 0
    ? SOL_PRICE_USD
    : null;
}

function formatFeeUsdEstimate(
  lamports: number,
  solPriceUsd?: number | null
): string | null {
  if (!solPriceUsd || !Number.isFinite(solPriceUsd) || solPriceUsd <= 0) {
    return null;
  }
  return `≈ ${formatUsdAmount((lamports / 1_000_000_000) * solPriceUsd)}`;
}

// Unit price for the picker's right column. Prices ≥ $1 show 2 decimals with
// thousands separators ($63.83, $62,705.07); sub-dollar prices keep up to 5
// decimals so stablecoins/low-cap tokens read precisely ($0.99866, $0.31201).
function formatUnitPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price) || price <= 0) return "$0";
  return price >= 1
    ? `$${formatWithCommas(price, 2, 2)}`
    : `$${formatWithCommas(price, 2, 5)}`;
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

function resolveInitialSwapMints(params: {
  initialFromMint?: string;
  initialToMint?: string;
  publicHoldings: TokenHolding[];
  toPickerTokens: TokenHolding[];
}) {
  const defaultToMint = getDefaultUsdcMint();
  const requestedFromMint = params.publicHoldings.some(
    (holding) => holding.mint === params.initialFromMint
  )
    ? (params.initialFromMint as string)
    : null;
  const requestedToMint = params.toPickerTokens.some(
    (holding) => holding.mint === params.initialToMint
  )
    ? (params.initialToMint as string)
    : null;

  let fromMint = requestedFromMint ?? NATIVE_SOL_MINT;
  let toMint = requestedToMint ?? defaultToMint;

  if (fromMint === toMint) {
    if (requestedFromMint) {
      const nextTo = params.toPickerTokens.find(
        (holding) => holding.mint !== fromMint
      );
      if (nextTo) {
        toMint = nextTo.mint;
      }
    } else {
      const nextFrom = params.publicHoldings.find(
        (holding) => holding.mint !== toMint
      );
      if (nextFrom) {
        fromMint = nextFrom.mint;
      }
    }
  }

  if (fromMint === toMint) {
    const nextTo = params.toPickerTokens.find(
      (holding) => holding.mint !== fromMint
    );
    if (nextTo) {
      toMint = nextTo.mint;
    }
  }

  return { fromMint, toMint };
}

export function SwapSheet({
  open,
  onClose,
  walletAddress,
  tokenHoldings,
  tokenDetailsByMint,
  onSwapComplete,
  initialFromMint,
  initialToMint,
}: SwapSheetProps) {
  const { signer } = useWallet();
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const sheetSettledRef = useRef(false);
  const swapInputRef = useRef<TextInput | null>(null);
  const [step, setStep] = useState<SwapStep>("form");
  const [fromMint, setFromMint] = useState(NATIVE_SOL_MINT);
  const [toMint, setToMint] = useState(getDefaultUsdcMint);
  // Holds the full token object for a "to" selection that isn't in the user's
  // holdings or the popular list (e.g. a Jupiter search result), so the form
  // can still display it. Without this, picking a searched token leaves
  // toHolding null and the selector falls back to the "Select" placeholder.
  const [selectedToToken, setSelectedToToken] = useState<TokenHolding | null>(
    null
  );
  const [amountStr, setAmountStr] = useState("");
  const [currencyMode, setCurrencyMode] = useState<"TOKEN" | "USD">("TOKEN");
  const [quote, setQuote] = useState<JupiterQuoteResponse | null>(null);
  const [feeEstimateState, setFeeEstimateState] =
    useState<SwapFeeEstimateState>({ status: "idle" });
  const [isFetchingQuote, setIsFetchingQuote] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [fromIsSecured, setFromIsSecured] = useState(false);
  const [swapStage, setSwapStage] = useState<
    "idle" | "unshielding" | "swapping"
  >("idle");

  const { executeUnshield } = useShield();

  const { tokens: popularTokens, searchTokens } = usePopularTokens();

  // From picker shows both public AND shielded balances. Shielded From
  // triggers an auto-unshield-then-swap flow. To picker stays public-only
  // — Jupiter routes deposit into the user's public token account.
  const publicHoldings = useMemo(
    () => tokenHoldings.filter((t) => !t.isSecured),
    [tokenHoldings]
  );
  const fromHoldings = useMemo(
    () => tokenHoldings.filter((t) => t.balance > 0),
    [tokenHoldings]
  );
  const toPickerTokens = useMemo(() => {
    const heldMints = new Set(publicHoldings.map((t) => t.mint));
    const popularAsHoldings: TokenHolding[] = popularTokens
      .filter((p) => !heldMints.has(p.mint))
      .map(popularToHolding);
    return [...publicHoldings, ...popularAsHoldings];
  }, [publicHoldings, popularTokens]);

  const fromHolding =
    tokenHoldings.find(
      (t) => t.mint === fromMint && Boolean(t.isSecured) === fromIsSecured
    ) ??
    tokenHoldings.find((t) => t.mint === fromMint) ??
    null;
  const toHolding =
    tokenHoldings.find((t) => t.mint === toMint) ??
    toPickerTokens.find((t) => t.mint === toMint) ??
    (selectedToToken?.mint === toMint ? selectedToToken : null);

  const fromPrice = fromHolding?.priceUsd ?? null;
  // `amountStr` is the value as typed in the active denomination; the quote and
  // every downstream check operate on the token amount, so derive it here.
  const amountInput = parseFloat(amountStr) || 0;
  const amountNum =
    currencyMode === "USD"
      ? fromPrice && fromPrice > 0
        ? amountInput / fromPrice
        : 0
      : amountInput;
  const fromBalance = fromHolding?.balance ?? 0;
  const isValidAmount = amountNum > 0 && amountNum <= fromBalance;
  const isFormValid = isValidAmount && !!quote && fromMint !== toMint;

  // Reset state on open/close transitions. Other inputs are intentionally
  // read at open time — re-running mid-flight would clobber the result step
  // after onSwapComplete refreshes holdings.
  useEffect(() => {
    if (open) {
      const initialMints = resolveInitialSwapMints({
        initialFromMint,
        initialToMint,
        publicHoldings,
        toPickerTokens,
      });
      bottomSheetRef.current?.present();
      setStep("form");
      setFromMint(initialMints.fromMint);
      setToMint(initialMints.toMint);
      setSelectedToToken(null);
      setFromIsSecured(false);
      setSwapStage("idle");
      setAmountStr("");
      setCurrencyMode("TOKEN");
      setQuote(null);
      setFeeEstimateState({ status: "idle" });
      setSwapError(null);
      setTxSignature(null);
      setIsSwapping(false);
      setShowFromPicker(false);
      setShowToPicker(false);
    } else {
      bottomSheetRef.current?.dismiss();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Fetch quote when amount/tokens change
  useEffect(() => {
    if (amountNum <= 0 || fromMint === toMint || !fromHolding) {
      setQuote(null);
      setFeeEstimateState({ status: "idle" });
      return;
    }

    const rawAmount = Math.floor(
      amountNum * 10 ** (fromHolding.decimals ?? 9)
    ).toString();

    let cancelled = false;
    setIsFetchingQuote(true);

    const timer = setTimeout(() => {
      getJupiterQuote({
        inputMint: fromMint,
        outputMint: toMint,
        amount: rawAmount,
      })
        .then((q) => {
          if (!cancelled) setQuote(q);
        })
        .catch(() => {
          if (!cancelled) setQuote(null);
        })
        .finally(() => {
          if (!cancelled) setIsFetchingQuote(false);
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setIsFetchingQuote(false);
    };
  }, [amountNum, fromMint, toMint, fromHolding]);

  useEffect(() => {
    if (!quote || !walletAddress) {
      setFeeEstimateState({ status: "idle" });
      return;
    }

    let cancelled = false;
    setFeeEstimateState({ status: "loading" });

    void (async () => {
      const nextState = await estimateJupiterSwapFeeState({
        connection: getConnection(),
        quoteResponse: quote,
        userPublicKey: walletAddress,
      });
      if (!cancelled) setFeeEstimateState(nextState);
    })();

    return () => {
      cancelled = true;
    };
  }, [quote, walletAddress]);

  // Focus the amount input once the sheet has settled at its snap point.
  // Focusing during the present animation pushes the keyboard above the sheet.
  const focusActiveInput = useCallback(() => {
    if (step === "form" && !showFromPicker && !showToPicker) {
      swapInputRef.current?.focus();
    }
  }, [step, showFromPicker, showToPicker]);

  const handleSheetChange = useCallback(
    (index: number) => {
      sheetSettledRef.current = index >= 0;
      if (index >= 0) {
        setTimeout(focusActiveInput, 120);
      }
    },
    [focusActiveInput]
  );

  // Re-focus the right input on step / picker transitions (the sheet is
  // already settled, so `onChange` won't fire again).
  useEffect(() => {
    if (!sheetSettledRef.current) return;
    const id = setTimeout(focusActiveInput, 80);
    return () => clearTimeout(id);
  }, [focusActiveInput]);

  const outAmount = useMemo(() => {
    if (!quote || !toHolding) return null;
    const decimals = toHolding.decimals ?? 9;
    return Number(quote.outAmount) / 10 ** decimals;
  }, [quote, toHolding]);

  const outUsd = useMemo(() => {
    if (outAmount === null) return null;
    if (
      typeof toHolding?.priceUsd === "number" &&
      Number.isFinite(toHolding.priceUsd) &&
      toHolding.priceUsd > 0
    ) {
      return outAmount * toHolding.priceUsd;
    }
    if (
      amountNum > 0 &&
      typeof fromHolding?.priceUsd === "number" &&
      Number.isFinite(fromHolding.priceUsd) &&
      fromHolding.priceUsd > 0
    ) {
      // Fallback to input-side USD estimate when output token price is unavailable.
      return amountNum * fromHolding.priceUsd;
    }
    return null;
  }, [outAmount, toHolding, amountNum, fromHolding]);
  const feeSolPriceUsd = useMemo(
    () =>
      getFeeSolPriceUsd([
        fromHolding,
        toHolding,
        selectedToToken,
        ...tokenHoldings,
        ...toPickerTokens,
      ]),
    [fromHolding, selectedToToken, toHolding, tokenHoldings, toPickerTokens]
  );

  const handleFlip = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const prevFrom = fromMint;
    const prevTo = toMint;
    setFromMint(prevTo);
    setToMint(prevFrom);
    // Flipping always resets to public source — shielded balance can only
    // sit on the From side, never the To side.
    setFromIsSecured(false);
    setAmountStr("");
    setCurrencyMode("TOKEN");
    setQuote(null);
    setFeeEstimateState({ status: "idle" });
  }, [fromMint, toMint]);

  const toggleCurrency = useCallback(() => {
    if (!fromPrice) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currencyMode === "TOKEN") {
      const usd = amountNum * fromPrice;
      setCurrencyMode("USD");
      setAmountStr(usd > 0 ? usd.toFixed(2) : "");
    } else {
      setCurrencyMode("TOKEN");
      setAmountStr(amountNum > 0 ? String(Number(amountNum.toFixed(6))) : "");
    }
  }, [currencyMode, amountNum, fromPrice]);

  const handleMax = useCallback(() => {
    if (!fromHolding) return;
    let val = fromBalance;
    // Reserve the network fee when maxing out SOL.
    const feeReserveSol =
      feeEstimateState.status === "success"
        ? feeEstimateState.estimate.totalLamports / 1_000_000_000
        : DEFAULT_SOL_MAX_FEE_RESERVE_LAMPORTS / 1_000_000_000;
    if (
      fromHolding.symbol.toUpperCase() === "SOL" &&
      fromBalance - val < feeReserveSol
    ) {
      val = Math.max(0, fromBalance - feeReserveSol);
    }
    // Truncate (never round) so float rounding can't push past the balance.
    const truncated = Math.floor(val * 1e6) / 1e6;
    if (truncated <= 0) {
      setAmountStr("");
    } else if (currencyMode === "USD" && fromPrice && fromPrice > 0) {
      setAmountStr((truncated * fromPrice).toFixed(2));
    } else {
      setAmountStr(String(truncated));
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [fromHolding, fromBalance, feeEstimateState, currencyMode, fromPrice]);

  const handleSwap = useCallback(async () => {
    if (!isFormValid || isSwapping || !walletAddress || !quote || !fromHolding)
      return;

    Keyboard.dismiss();
    setIsSwapping(true);
    setSwapError(null);
    setStep("result");

    try {
      // Jupiter routes operate on the user's public token account. If the
      // selected source is shielded, we have to materialize the funds in
      // the public account first via unshield.
      if (fromIsSecured) {
        setSwapStage("unshielding");
        const unshieldResult = await executeUnshield({
          tokenSymbol: fromHolding.symbol,
          amount: amountNum,
          tokenMint: fromHolding.mint,
          tokenDecimals: fromHolding.decimals,
        });
        if (!unshieldResult.success) {
          throw new Error(unshieldResult.error ?? "Unshield failed");
        }
      }

      setSwapStage("swapping");

      const swapTxResponse = await getJupiterSwapTransaction({
        quoteResponse: quote,
        userPublicKey: walletAddress,
      });

      const txBuf = Buffer.from(swapTxResponse.swapTransaction, "base64");
      const transaction = VersionedTransaction.deserialize(txBuf);
      if (!signer) throw new Error("Wallet signer is not available");
      // The dedicated review step already confirms the swap, so sign directly
      // — no extra decoded-transaction approval modal. (Seed Vault wallets
      // still get their own native biometric prompt.)
      await signer.signTransaction(transaction);

      const connection = getConnection();
      const sig = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 2,
      });
      await connection.confirmTransaction(sig, "confirmed");

      setTxSignature(sig);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      track(SWAP_EVENTS.swapTokens, {
        from_shielded: fromIsSecured,
      });
      onSwapComplete?.();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Swap failed";
      const friendly = getFriendlyError(msg);
      const stageAtFailure = swapStage;
      const recovery =
        stageAtFailure === "swapping" && fromIsSecured && fromHolding
          ? `${friendly} Your ${fromHolding.symbol} is now unshielded — retry the swap to complete it.`
          : friendly;
      setSwapError(recovery);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      track(SWAP_EVENTS.swapTokensFailed, {
        from_shielded: fromIsSecured,
      });
    } finally {
      setIsSwapping(false);
      setSwapStage("idle");
    }
  }, [
    isFormValid,
    isSwapping,
    walletAddress,
    quote,
    fromHolding,
    fromIsSecured,
    amountNum,
    executeUnshield,
    onSwapComplete,
    swapStage,
    signer,
  ]);

  const handleClose = useCallback(() => {
    bottomSheetRef.current?.dismiss();
    onClose();
  }, [onClose]);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.3}
      />
    ),
    []
  );

  const selectFromToken = useCallback(
    (mint: string, isSecured: boolean) => {
      setFromMint(mint);
      setFromIsSecured(isSecured);
      setShowFromPicker(false);
      setQuote(null);
      setFeeEstimateState({ status: "idle" });
      if (mint === toMint) {
        setToMint(fromMint);
      }
    },
    [toMint, fromMint]
  );

  const selectToToken = useCallback(
    (token: TokenHolding) => {
      setToMint(token.mint);
      setSelectedToToken(token);
      setShowToPicker(false);
      setQuote(null);
      setFeeEstimateState({ status: "idle" });
      if (token.mint === fromMint) {
        setFromMint(toMint);
        setFromIsSecured(false);
      }
    },
    [fromMint, toMint]
  );

  const showForm = step === "form" && !showFromPicker && !showToPicker;

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={SWAP_SNAP_POINTS}
      enableDynamicSizing={false}
      enablePanDownToClose={step !== "result" || !isSwapping}
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
          height: SHEET_HEIGHT,
          backgroundColor: "#fff",
          borderTopLeftRadius: 38,
          borderTopRightRadius: 38,
          overflow: "hidden",
        }}
      >
        {showForm && (
          <FormStep
            onClose={handleClose}
            fromHolding={fromHolding}
            toHolding={toHolding}
            tokenDetailsByMint={tokenDetailsByMint}
            amountStr={amountStr}
            onAmountChange={setAmountStr}
            currencyMode={currencyMode}
            onToggleCurrency={toggleCurrency}
            fromPrice={fromPrice}
            amountNum={amountNum}
            onMax={handleMax}
            onFlip={handleFlip}
            onFromPress={() => {
              Keyboard.dismiss();
              setShowFromPicker(true);
            }}
            onToPress={() => {
              Keyboard.dismiss();
              setShowToPicker(true);
            }}
            fromBalance={fromBalance}
            outAmount={outAmount}
            outUsd={outUsd}
            isFetchingQuote={isFetchingQuote}
            isFormValid={isFormValid}
            onReview={() => {
              Keyboard.dismiss();
              setStep("confirm");
            }}
            swapInputRef={swapInputRef}
          />
        )}

        {step === "form" && (showFromPicker || showToPicker) && (
          <BottomSheetScrollView
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            {showFromPicker ? (
              <TokenPicker
                mode="from"
                title="You swap"
                tokenHoldings={fromHoldings}
                tokenDetailsByMint={tokenDetailsByMint}
                onSelect={(token) =>
                  selectFromToken(token.mint, Boolean(token.isSecured))
                }
                onBack={() => setShowFromPicker(false)}
              />
            ) : (
              <TokenPicker
                mode="to"
                title="You receive"
                tokenHoldings={toPickerTokens}
                tokenDetailsByMint={tokenDetailsByMint}
                searchTokens={searchTokens}
                onSelect={(token) => selectToToken(token)}
                onBack={() => setShowToPicker(false)}
              />
            )}
          </BottomSheetScrollView>
        )}

        {step === "confirm" && (
          <ConfirmStep
            fromHolding={fromHolding}
            toHolding={toHolding}
            tokenDetailsByMint={tokenDetailsByMint}
            amountNum={amountNum}
            outAmount={outAmount}
            outUsd={outUsd}
            quote={quote}
            feeEstimateState={feeEstimateState}
            feeSolPriceUsd={feeSolPriceUsd}
            isSwapping={isSwapping}
            onConfirm={handleSwap}
            onBack={() => setStep("form")}
          />
        )}

        {step === "result" && (
          <ResultStep
            isSwapping={isSwapping}
            swapError={swapError}
            swapStage={swapStage}
            txSignature={txSignature}
            toHolding={toHolding}
            outAmount={outAmount}
            onDone={handleClose}
          />
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
}

// --- Swap token pill (You swap / You receive selector) ---
function SwapTokenPill({
  holding,
  detailLogoUrl,
  onPress,
}: {
  holding: TokenHolding | null;
  detailLogoUrl?: string | null;
  onPress: () => void;
}) {
  const icon = holding
    ? getTokenIcon(holding, detailLogoUrl)
    : DEFAULT_TOKEN_ICON;
  const symbol = holding?.symbol ?? "Select";
  const isSecured = Boolean(holding?.isSecured);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Change token"
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: "rgba(0,0,0,0.04)",
        borderRadius: 54,
        paddingHorizontal: 4,
      }}
    >
      <View style={{ paddingRight: 6 }}>
        <View style={{ position: "relative" }}>
          <Image
            source={{ uri: icon }}
            style={{ width: 28, height: 28, borderRadius: 14 }}
          />
          {isSecured ? (
            <Image
              source={shieldBadge}
              style={{
                position: "absolute",
                bottom: -2,
                right: -2,
                width: 14,
                height: 14,
              }}
            />
          ) : null}
        </View>
      </View>
      <View style={{ paddingVertical: 7 }}>
        <Text
          className="text-[17px] font-medium text-black"
          style={{ lineHeight: 22 }}
        >
          {symbol}
        </Text>
      </View>
      <View
        style={{
          height: 36,
          alignItems: "center",
          justifyContent: "center",
          paddingLeft: 4,
        }}
      >
        <ChevronRight size={16} color="rgba(60,60,67,0.3)" strokeWidth={2.5} />
      </View>
    </Pressable>
  );
}

// --- Helpers ---
function popularToHolding(p: PopularToken): TokenHolding {
  return {
    mint: p.mint,
    symbol: p.symbol,
    name: p.name,
    balance: 0,
    decimals: p.decimals,
    priceUsd: p.priceUsd,
    valueUsd: p.priceUsd ? 0 : null,
    imageUrl: p.icon,
  };
}

// --- Token Picker ---
function TokenPicker({
  mode,
  title,
  tokenHoldings,
  tokenDetailsByMint,
  searchTokens,
  onSelect,
  onBack,
}: {
  mode: "from" | "to";
  title: string;
  tokenHoldings: TokenHolding[];
  tokenDetailsByMint?: TokenDetailsByMint;
  searchTokens?: (query: string) => Promise<PopularToken[]>;
  onSelect: (token: TokenHolding) => void;
  onBack: () => void;
}) {
  const [search, setSearch] = useState("");
  const [jupiterResults, setJupiterResults] = useState<TokenHolding[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Local filter
  const localFiltered = useMemo(() => {
    const base = tokenHoldings;
    if (!search.trim()) return base;
    const lower = search.toLowerCase();
    return base.filter(
      (t) =>
        t.symbol.toLowerCase().includes(lower) ||
        t.name.toLowerCase().includes(lower) ||
        t.mint.toLowerCase().includes(lower)
    );
  }, [tokenHoldings, search]);

  // Debounced Jupiter search for "to" mode
  useEffect(() => {
    if (mode !== "to" || !searchTokens || search.trim().length < 2) {
      setJupiterResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      searchTokens(search.trim())
        .then((results) => {
          const localMints = new Set(tokenHoldings.map((t) => t.mint));
          const converted = results
            .filter((r) => !localMints.has(r.mint))
            .map(popularToHolding);
          setJupiterResults(converted);
          setIsSearching(false);
        })
        .catch(() => {
          setJupiterResults([]);
          setIsSearching(false);
        });
    }, 300);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search, mode, searchTokens, tokenHoldings]);

  // Merge local + Jupiter results (deduplicated)
  const displayTokens = useMemo(() => {
    if (mode !== "to" || jupiterResults.length === 0) return localFiltered;
    const localMints = new Set(localFiltered.map((t) => t.mint));
    const extra = jupiterResults.filter((t) => !localMints.has(t.mint));
    return [...localFiltered, ...extra];
  }, [mode, localFiltered, jupiterResults]);

  return (
    <View className="w-full">
      {/* Toolbar: circular back + centered title */}
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
              {title}
            </Text>
          </View>
          <View className="h-11 w-11" style={{ opacity: 0 }} />
        </View>
      </View>

      {/* Search */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
        <View
          className="flex-row items-center"
          style={{
            backgroundColor: "#f2f2f7",
            borderRadius: 47,
            paddingHorizontal: 16,
          }}
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

      {/* Token list */}
      {displayTokens.map((token) => {
        const icon = getTokenIcon(
          token,
          tokenDetailsByMint?.[token.mint]?.token.logoUrl
        );
        const isSecured = Boolean(token.isSecured);
        // "To" picker chooses what to receive → show the unit price. "From"
        // picker chooses from holdings → show held balance + its USD value.
        const subLabel =
          mode === "to"
            ? token.symbol
            : `${formatTokenAmount(token.balance)} ${token.symbol}`;
        const rightValue =
          mode === "to"
            ? formatUnitPrice(token.priceUsd)
            : formatUsdAmount(token.balance * (token.priceUsd ?? 0));
        return (
          <Pressable
            key={`${token.mint}:${isSecured ? "shielded" : "public"}`}
            className="w-full flex-row items-center"
            style={{ paddingHorizontal: 16 }}
            onPress={() => onSelect(token)}
            accessibilityRole="button"
            accessibilityLabel={`Select ${token.name}`}
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
                {isSecured ? (
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
                {token.name}
              </Text>
              <Text
                className="text-[15px] font-normal"
                style={{ color: "rgba(60,60,67,0.6)", lineHeight: 20 }}
                numberOfLines={1}
              >
                {subLabel}
              </Text>
            </View>
            <View style={{ paddingLeft: 12 }}>
              <Text
                className="text-[17px] font-medium text-black"
                style={{ lineHeight: 22 }}
              >
                {rightValue}
              </Text>
            </View>
          </Pressable>
        );
      })}

      {/* Searching indicator */}
      {isSearching ? (
        <View
          className="flex-row items-center justify-center"
          style={{ paddingVertical: 16 }}
        >
          <ActivityIndicator size="small" color="rgba(60,60,67,0.6)" />
          <Text
            className="text-[15px]"
            style={{ marginLeft: 8, color: "rgba(60,60,67,0.6)" }}
          >
            Searching…
          </Text>
        </View>
      ) : null}

      {displayTokens.length === 0 && !isSearching ? (
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

// --- Form Step ---
function FormStep({
  onClose,
  fromHolding,
  toHolding,
  tokenDetailsByMint,
  amountStr,
  onAmountChange,
  currencyMode,
  onToggleCurrency,
  fromPrice,
  amountNum,
  onMax,
  onFlip,
  onFromPress,
  onToPress,
  fromBalance,
  outAmount,
  outUsd,
  isFetchingQuote,
  isFormValid,
  onReview,
  swapInputRef,
}: {
  onClose: () => void;
  fromHolding: TokenHolding | null;
  toHolding: TokenHolding | null;
  tokenDetailsByMint?: TokenDetailsByMint;
  amountStr: string;
  onAmountChange: (v: string) => void;
  currencyMode: "TOKEN" | "USD";
  onToggleCurrency: () => void;
  fromPrice: number | null;
  amountNum: number;
  onMax: () => void;
  onFlip: () => void;
  onFromPress: () => void;
  onToPress: () => void;
  fromBalance: number;
  outAmount: number | null;
  outUsd: number | null;
  isFetchingQuote: boolean;
  isFormValid: boolean;
  onReview: () => void;
  swapInputRef: React.RefObject<TextInput | null>;
}) {
  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard();
  const footerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboard.height.value }],
  }));
  const fromSymbol = fromHolding?.symbol ?? "";
  const toBalance = toHolding?.balance ?? 0;

  // Custom blinking caret — the real input's caret is hidden (it's a
  // transparent overlay over the formatted amount). Mirrors SendSheet.
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

  const swapDisplay = formatAmountInputDisplay(amountStr) || "0";
  const swapBig = currencyMode === "USD" ? `$${swapDisplay}` : swapDisplay;
  const swapSub =
    currencyMode === "USD"
      ? `${formatTokenAmount(amountNum)} ${fromSymbol}`
      : formatUsdAmount(fromPrice ? amountNum * fromPrice : 0);

  const receiveBig =
    outAmount != null ? formatWithCommas(outAmount, 0, 6) : "0";
  const receiveSub = outUsd != null ? `≈${formatUsdAmount(outUsd)}` : "$0";

  const labelStyle = { color: "rgba(60,60,67,0.6)", lineHeight: 20 } as const;

  // CTA state. No amount → dim "Enter amount" (translucent-black fill so the
  // label stays crisp white); over balance → light-red "Insufficient balance";
  // valid + quote ready → solid-black "Review".
  const hasAmount = amountNum > 0;
  const overBalance = hasAmount && amountNum > fromBalance;
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

  return (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View style={{ paddingVertical: 16 }}>
        <View className="flex-row items-center justify-between px-4">
          <Pressable
            className="h-11 w-11 items-center justify-center rounded-full bg-[#f2f2f7]"
            hitSlop={6}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <X size={24} color="rgba(60,60,67,0.6)" strokeWidth={2} />
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
              Swap
            </Text>
          </View>
          <View className="h-11 w-11" style={{ opacity: 0 }} />
        </View>
      </View>

      {/* Body */}
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        {/* You swap */}
        <View style={{ paddingVertical: 10 }}>
          <Text className="text-[15px] font-normal" style={labelStyle}>
            You swap
          </Text>
          <View
            className="flex-row items-center"
            style={{ height: 48, gap: 4 }}
          >
            <Pressable
              style={{
                flex: 1,
                position: "relative",
                justifyContent: "center",
              }}
              onPress={() => swapInputRef.current?.focus()}
            >
              <View
                className="flex-row items-center"
                style={{ maxWidth: "100%" }}
                pointerEvents="none"
              >
                <Text
                  className="font-semibold text-black"
                  style={{ fontSize: 32, lineHeight: 36, flexShrink: 1 }}
                  numberOfLines={1}
                >
                  {swapBig}
                </Text>
                <View
                  style={{
                    width: 2,
                    height: 30,
                    marginLeft: 2,
                    borderRadius: 1,
                    backgroundColor: "#000",
                    opacity: isFocused && caretOn ? 1 : 0,
                  }}
                />
              </View>
              <BottomSheetTextInput
                ref={swapInputRef as unknown as React.Ref<never>}
                value={amountStr}
                onChangeText={(t) => onAmountChange(stripAmountInput(t))}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                keyboardType="decimal-pad"
                inputMode="decimal"
                maxLength={15}
                caretHidden
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  opacity: 0,
                  padding: 0,
                  fontSize: 32,
                }}
                accessibilityLabel="Swap amount"
              />
            </Pressable>
            <SwapTokenPill
              holding={fromHolding}
              detailLogoUrl={
                fromHolding
                  ? tokenDetailsByMint?.[fromHolding.mint]?.token.logoUrl
                  : undefined
              }
              onPress={onFromPress}
            />
          </View>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center" style={{ gap: 4 }}>
              <Text className="text-[15px] font-normal" style={labelStyle}>
                {swapSub}
              </Text>
              {fromPrice ? (
                <Pressable
                  onPress={onToggleCurrency}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Switch between token and USD"
                >
                  <SwapCurrencyIcon width={16} height={16} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              className="flex-row items-center"
              style={{ gap: 4 }}
              onPress={onMax}
              accessibilityRole="button"
              accessibilityLabel="Use max balance"
            >
              <Text
                className="text-[15px] font-normal text-black"
                style={{ lineHeight: 20 }}
              >
                MAX
              </Text>
              <Text className="text-[15px] font-normal" style={labelStyle}>
                {formatTokenAmount(fromBalance)}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Divider + flip */}
        <View
          style={{ height: 28, alignItems: "center", justifyContent: "center" }}
        >
          <View
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 14,
              height: 1,
              backgroundColor: "rgba(60,60,67,0.12)",
            }}
          />
          <Pressable
            onPress={onFlip}
            accessibilityRole="button"
            accessibilityLabel="Swap direction"
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: "#f5f5f5",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ArrowUpDown size={20} color="#8A8A8E" strokeWidth={1.5} />
          </Pressable>
        </View>

        {/* You receive */}
        <View style={{ paddingVertical: 12 }}>
          <Text className="text-[15px] font-normal" style={labelStyle}>
            You receive
          </Text>
          <View
            className="flex-row items-center"
            style={{ height: 48, gap: 4 }}
          >
            <View style={{ flex: 1, justifyContent: "center" }}>
              {isFetchingQuote && outAmount == null ? (
                <ActivityIndicator
                  size="small"
                  color="rgba(60,60,67,0.6)"
                  style={{ alignSelf: "flex-start" }}
                />
              ) : (
                <Text
                  className="font-semibold text-black"
                  style={{ fontSize: 32, lineHeight: 36 }}
                  numberOfLines={1}
                >
                  {receiveBig}
                </Text>
              )}
            </View>
            <SwapTokenPill
              holding={toHolding}
              detailLogoUrl={
                toHolding
                  ? tokenDetailsByMint?.[toHolding.mint]?.token.logoUrl
                  : undefined
              }
              onPress={onToPress}
            />
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-[15px] font-normal" style={labelStyle}>
              {receiveSub}
            </Text>
            <Text className="text-[15px] font-normal" style={labelStyle}>
              Balance: {formatTokenAmount(toBalance)}
            </Text>
          </View>
        </View>
      </View>

      {/* CTA — pinned to the sheet bottom and rides up with the keyboard. */}
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "#fff",
            paddingTop: 16,
            paddingBottom: insets.bottom + 12,
            paddingHorizontal: 20,
          },
          footerStyle,
        ]}
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
      </Animated.View>
    </View>
  );
}

function ConfirmStep({
  fromHolding,
  toHolding,
  tokenDetailsByMint,
  amountNum,
  outAmount,
  outUsd,
  quote,
  feeEstimateState,
  feeSolPriceUsd,
  isSwapping,
  onConfirm,
  onBack,
}: {
  fromHolding: TokenHolding | null;
  toHolding: TokenHolding | null;
  tokenDetailsByMint?: TokenDetailsByMint;
  amountNum: number;
  outAmount: number | null;
  outUsd: number | null;
  quote: JupiterQuoteResponse | null;
  feeEstimateState: SwapFeeEstimateState;
  feeSolPriceUsd: number | null;
  isSwapping: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const fromSymbol = fromHolding?.symbol ?? "";
  const toSymbol = toHolding?.symbol ?? "";
  const fromIcon = fromHolding
    ? getTokenIcon(
        fromHolding,
        tokenDetailsByMint?.[fromHolding.mint]?.token.logoUrl
      )
    : DEFAULT_TOKEN_ICON;
  const toIcon = toHolding
    ? getTokenIcon(
        toHolding,
        tokenDetailsByMint?.[toHolding.mint]?.token.logoUrl
      )
    : DEFAULT_TOKEN_ICON;
  const rate = outAmount && outAmount > 0 ? amountNum / outAmount : null;
  const slippagePct = quote
    ? Number((quote.slippageBps / 100).toFixed(2))
    : null;
  const dim = { color: "rgba(60,60,67,0.6)" } as const;

  return (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View style={{ paddingVertical: 16 }}>
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
              Swap
            </Text>
          </View>
          <View className="h-11 w-11" style={{ opacity: 0 }} />
        </View>
      </View>

      {/* Token pair */}
      <View
        className="flex-row"
        style={{ paddingHorizontal: 16, paddingVertical: 8 }}
      >
        <Image
          source={{ uri: fromIcon }}
          style={{ width: 64, height: 64, borderRadius: 32 }}
        />
        <Image
          source={{ uri: toIcon }}
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            marginLeft: -16,
            borderWidth: 2,
            borderColor: "#fff",
          }}
        />
      </View>

      {/* Amounts */}
      <View style={{ paddingHorizontal: 24, paddingBottom: 20, gap: 4 }}>
        <View className="flex-row items-baseline" style={{ gap: 8 }}>
          <Text
            className="font-semibold text-black"
            style={{ fontSize: 40, lineHeight: 48 }}
          >
            −{formatTokenAmount(amountNum, 0)}
          </Text>
          <Text
            className="font-semibold"
            style={{ fontSize: 28, color: "rgba(60,60,67,0.4)" }}
          >
            {fromSymbol}
          </Text>
        </View>
        <View className="flex-row items-baseline" style={{ gap: 8 }}>
          <Text
            className="font-semibold"
            style={{ fontSize: 40, lineHeight: 48, color: "#34c759" }}
          >
            +{outAmount != null ? formatWithCommas(outAmount, 0, 6) : "0"}
          </Text>
          <Text
            className="font-semibold"
            style={{ fontSize: 28, color: "rgba(60,60,67,0.4)" }}
          >
            {toSymbol}
          </Text>
        </View>
        {outUsd != null ? (
          <Text
            className="text-[17px] font-normal"
            style={{ ...dim, lineHeight: 22 }}
          >
            ≈{formatUsdAmount(outUsd)}
          </Text>
        ) : null}
      </View>

      {/* Rate / slippage / fee */}
      <View style={{ paddingHorizontal: 16 }}>
        <View
          style={{
            backgroundColor: "#f2f2f7",
            borderRadius: 20,
            paddingVertical: 4,
          }}
        >
          <ConfirmRow label="Rate">
            <Text className="text-[17px] text-black" style={{ lineHeight: 22 }}>
              1 {toSymbol}
            </Text>
            <Text className="text-[17px]" style={{ ...dim, lineHeight: 22 }}>
              {` ≈ ${
                rate != null ? formatTokenAmount(rate, 0) : "—"
              } ${fromSymbol}`}
            </Text>
          </ConfirmRow>
          <ConfirmRow label="Slippage">
            <Text className="text-[17px] text-black" style={{ lineHeight: 22 }}>
              {slippagePct != null ? `${slippagePct}%` : "—"}
            </Text>
          </ConfirmRow>
          <FeeBreakdownRows
            feeEstimateState={feeEstimateState}
            solPriceUsd={feeSolPriceUsd}
          />
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
            opacity: isSwapping ? 0.4 : 1,
          }}
          onPress={onConfirm}
          disabled={isSwapping}
          accessibilityRole="button"
          accessibilityLabel="Confirm swap"
        >
          <Text
            className="text-[16px] font-medium text-white"
            style={{ lineHeight: 20 }}
          >
            Confirm
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function FeeValue({
  lamports,
  muted = false,
  solPriceUsd,
}: {
  lamports: number;
  muted?: boolean;
  solPriceUsd?: number | null;
}) {
  const usdEstimate = formatFeeUsdEstimate(lamports, solPriceUsd);
  return (
    <>
      <Text
        className="text-[17px] text-black"
        style={{
          lineHeight: 22,
          color: muted ? "rgba(60,60,67,0.6)" : "#000",
        }}
      >
        {formatLamportsAsSol(lamports)} SOL
      </Text>
      {usdEstimate ? (
        <Text className="text-[17px]" style={{ color: "rgba(60,60,67,0.6)" }}>
          {` ${usdEstimate}`}
        </Text>
      ) : null}
    </>
  );
}

function FeeSkeleton() {
  return (
    <View
      style={{
        width: 92,
        height: 18,
        borderRadius: 9,
        backgroundColor: "rgba(60,60,67,0.14)",
      }}
    />
  );
}

function FeeBreakdownRows({
  feeEstimateState,
  solPriceUsd,
}: {
  feeEstimateState: SwapFeeEstimateState;
  solPriceUsd?: number | null;
}) {
  if (feeEstimateState.status === "success") {
    const { estimate } = feeEstimateState;
    if (estimate.rentLamports > 0) {
      return (
        <>
          <ConfirmRow label="Network Fee">
            <FeeValue
              lamports={estimate.transactionFeeLamports}
              solPriceUsd={solPriceUsd}
            />
          </ConfirmRow>
          <ConfirmRow label="Rent Fee">
            <FeeValue
              lamports={estimate.rentLamports}
              solPriceUsd={solPriceUsd}
            />
          </ConfirmRow>
          <ConfirmRow label="Total Fee">
            <FeeValue
              lamports={estimate.totalLamports}
              solPriceUsd={solPriceUsd}
            />
          </ConfirmRow>
        </>
      );
    }
    return (
      <ConfirmRow label="Network Fee">
        <FeeValue lamports={estimate.totalLamports} solPriceUsd={solPriceUsd} />
      </ConfirmRow>
    );
  }

  if (feeEstimateState.status === "error") {
    return (
      <ConfirmRow label="Network Fee">
        <Text className="text-[17px] text-black" style={{ lineHeight: 22 }}>
          -
        </Text>
      </ConfirmRow>
    );
  }

  return (
    <ConfirmRow label="Network Fee">
      <FeeSkeleton />
    </ConfirmRow>
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

// Continuously rotating red spinner arc, shown while the swap is in flight.
function SwappingSpinner() {
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 900, easing: Easing.linear }),
      -1,
      false
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
  isSwapping,
  swapError,
  swapStage,
  txSignature,
  toHolding,
  outAmount,
  onDone,
}: {
  isSwapping: boolean;
  swapError: string | null;
  swapStage: "idle" | "unshielding" | "swapping";
  txSignature: string | null;
  toHolding: TokenHolding | null;
  outAmount: number | null;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const status = isSwapping ? "swapping" : swapError ? "error" : "success";
  const toSymbol = toHolding?.symbol ?? "";

  const explorerUrl = txSignature
    ? `https://solscan.io/tx/${txSignature}${
        getSolanaEnv() === "mainnet" ? "" : `?cluster=${getSolanaEnv()}`
      }`
    : null;

  const title =
    status === "swapping"
      ? swapStage === "unshielding"
        ? "Unshielding…"
        : "Swapping…"
      : status === "success"
      ? "Swapped"
      : "Transaction failed";

  return (
    <View className="w-full" style={{ flex: 1 }}>
      {/* Toolbar */}
      <View className="w-full" style={{ paddingVertical: 16 }}>
        <View className="flex-row items-center justify-between px-4">
          <Pressable
            className="h-11 w-11 items-center justify-center rounded-full bg-[#f2f2f7]"
            hitSlop={6}
            onPress={onDone}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <X size={24} color="rgba(60,60,67,0.6)" strokeWidth={2} />
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
              Swap
            </Text>
          </View>
          <View className="h-11 w-11" style={{ opacity: 0 }} />
        </View>
      </View>

      {/* Centered status: mascot/spinner + copy */}
      <View
        className="flex-1 items-center justify-center"
        style={{ paddingHorizontal: 32, paddingVertical: 24 }}
      >
        <View className="w-full items-center" style={{ gap: 20 }}>
          {status === "swapping" ? (
            <SwappingSpinner />
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
                  {outAmount != null ? formatWithCommas(outAmount, 0, 6) : "—"}{" "}
                  {toSymbol}
                </Text>
                <Text style={{ color: "rgba(60,60,67,0.6)" }}>
                  {" has been deposited to your wallet"}
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
                {status === "swapping"
                  ? "You can close this screen and continue using the app"
                  : swapError ?? "Something went wrong. Please try again."}
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Footer: Done + (when available) View transaction */}
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
