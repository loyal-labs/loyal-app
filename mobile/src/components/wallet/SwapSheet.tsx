import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { VersionedTransaction } from "@solana/web3.js";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import {
  AlertCircle,
  ArrowDownUp,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Search,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard } from "react-native";

import type { PopularToken } from "@/hooks/wallet/usePopularTokens";
import { usePopularTokens } from "@/hooks/wallet/usePopularTokens";
import { useShield } from "@/hooks/wallet/useShield";
import { track } from "@/lib/analytics/analytics";
import { SWAP_EVENTS } from "@/lib/analytics/swap-events";
import {
  NATIVE_SOL_MINT,
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDC_MINT_MAINNET,
} from "@/lib/solana/constants";
import {
  getJupiterQuote,
  getJupiterSwapTransaction,
  type JupiterQuoteResponse,
} from "@/lib/solana/jupiter";
import { getConnection, getSolanaEnv } from "@/lib/solana/rpc/connection";
import { DEFAULT_TOKEN_ICON } from "@/lib/solana/token-holdings/constants";
import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import type { TokenDetailsByMint } from "@/hooks/wallet/useTokenDetails";
import { useSignApproval, withConfirmation } from "@/lib/wallet/sign-approval";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, Text, View } from "@/tw";

const shieldBadge = require("../../../assets/images/shield-badge.png");

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
  detailLogoUrl?: string | null,
): string =>
  resolveTokenIcon({
    mint: holding.mint,
    imageUrl: holding.imageUrl,
    detailLogoUrl,
  });

function getFriendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("insufficient lamports") || lower.includes("not enough sol"))
    return "You don't have enough SOL to complete this swap.";
  if (lower.includes("insufficient funds"))
    return "Insufficient funds for this swap.";
  if (lower.includes("slippage") || lower.includes("exceeds"))
    return "Price moved too much. Try increasing slippage or retry.";
  if (lower.includes("blockhash not found") || lower.includes("block height exceeded"))
    return "The transaction expired. Please try again.";
  if (lower.includes("timeout") || lower.includes("timed out"))
    return "The transaction timed out. Please try again.";
  if (raw.length > 120) return "Something went wrong. Please try again.";
  return raw;
}

function resolveInitialSwapMints(params: {
  initialFromMint?: string;
  initialToMint?: string;
  publicHoldings: TokenHolding[];
  toPickerTokens: TokenHolding[];
}) {
  const defaultToMint = getDefaultUsdcMint();
  const requestedFromMint = params.publicHoldings.some(
    (holding) => holding.mint === params.initialFromMint,
  )
    ? (params.initialFromMint as string)
    : null;
  const requestedToMint = params.toPickerTokens.some(
    (holding) => holding.mint === params.initialToMint,
  )
    ? (params.initialToMint as string)
    : null;

  let fromMint = requestedFromMint ?? NATIVE_SOL_MINT;
  let toMint = requestedToMint ?? defaultToMint;

  if (fromMint === toMint) {
    if (requestedFromMint) {
      const nextTo = params.toPickerTokens.find((holding) => holding.mint !== fromMint);
      if (nextTo) {
        toMint = nextTo.mint;
      }
    } else {
      const nextFrom = params.publicHoldings.find((holding) => holding.mint !== toMint);
      if (nextFrom) {
        fromMint = nextFrom.mint;
      }
    }
  }

  if (fromMint === toMint) {
    const nextTo = params.toPickerTokens.find((holding) => holding.mint !== fromMint);
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
  const signApproval = useSignApproval();
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const [step, setStep] = useState<SwapStep>("form");
  const [fromMint, setFromMint] = useState(NATIVE_SOL_MINT);
  const [toMint, setToMint] = useState(getDefaultUsdcMint);
  const [amountStr, setAmountStr] = useState("");
  const [quote, setQuote] = useState<JupiterQuoteResponse | null>(null);
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
    [tokenHoldings],
  );
  const fromHoldings = useMemo(
    () => tokenHoldings.filter((t) => t.balance > 0),
    [tokenHoldings],
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
      (t) => t.mint === fromMint && Boolean(t.isSecured) === fromIsSecured,
    ) ??
    tokenHoldings.find((t) => t.mint === fromMint) ??
    null;
  const toHolding =
    tokenHoldings.find((t) => t.mint === toMint) ??
    toPickerTokens.find((t) => t.mint === toMint) ??
    null;

  const amountNum = parseFloat(amountStr) || 0;
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
      setFromIsSecured(false);
      setSwapStage("idle");
      setAmountStr("");
      setQuote(null);
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
    setQuote(null);
  }, [fromMint, toMint]);

  const handlePercentage = useCallback(
    (pct: number) => {
      if (!fromHolding) return;
      let val = pct === 100 ? fromBalance : fromBalance * (pct / 100);
      // Reserve fee when sending SOL
      if (fromHolding.symbol.toUpperCase() === "SOL" && fromBalance - val < 0.00005) {
        val = Math.max(0, fromBalance - 0.00005);
      }
      // Truncate (never round) so floating-point rounding can't push the
      // amount past the balance minus the fee reserve.
      const displayScale = 1e6;
      const truncated = Math.floor(val * displayScale) / displayScale;
      setAmountStr(truncated > 0 ? String(truncated) : "");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [fromHolding, fromBalance],
  );

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
      const confirmingSigner = withConfirmation(signer, signApproval, {
        title: `Swap ${fromHolding.symbol} → ${toHolding?.symbol ?? "token"}`,
        subtitle: `${amountNum} ${fromHolding.symbol}`,
      });
      await confirmingSigner.signTransaction(transaction);

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
      const msg =
        error instanceof Error ? error.message : "Swap failed";
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
    toHolding?.symbol,
    signer,
    signApproval,
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
    [],
  );

  const selectFromToken = useCallback(
    (mint: string, isSecured: boolean) => {
      setFromMint(mint);
      setFromIsSecured(isSecured);
      setShowFromPicker(false);
      setQuote(null);
      if (mint === toMint) {
        setToMint(fromMint);
      }
    },
    [toMint, fromMint],
  );

  const selectToToken = useCallback(
    (mint: string) => {
      setToMint(mint);
      setShowToPicker(false);
      setQuote(null);
      if (mint === fromMint) {
        setFromMint(toMint);
        setFromIsSecured(false);
      }
    },
    [fromMint, toMint],
  );

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={["92%"]}
      enablePanDownToClose={step !== "result" || !isSwapping}
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
      handleIndicatorStyle={{ backgroundColor: "rgba(0,0,0,0.15)", width: 36 }}
      backgroundStyle={{ borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetScrollView keyboardShouldPersistTaps="handled">
        <View className="px-6 pb-12 pt-2">
          {/* Header */}
          <View className="mb-4 flex-row items-center justify-center">
            {(step === "confirm" || showFromPicker || showToPicker) && (
              <Pressable
                className="absolute left-0"
                onPress={() => {
                  if (showFromPicker) {
                    setShowFromPicker(false);
                    return;
                  }
                  if (showToPicker) {
                    setShowToPicker(false);
                    return;
                  }
                  setStep("form");
                }}
              >
                <ArrowLeft size={24} color="#000" />
              </Pressable>
            )}
            <Text
              className="text-[17px] font-semibold text-black"
              style={{ lineHeight: 22 }}
            >
              {showFromPicker
                ? "Select From"
                : showToPicker
                  ? "Select To"
                  : step === "form"
                    ? "Swap"
                    : step === "confirm"
                      ? "Confirm Swap"
                      : ""}
            </Text>
          </View>

          {step === "form" && (
            <>
              {showFromPicker ? (
                <TokenPicker
                  mode="from"
                  tokenHoldings={fromHoldings}
                  tokenDetailsByMint={tokenDetailsByMint}
                  onSelect={(mint, isSecured) =>
                    selectFromToken(mint, Boolean(isSecured))
                  }
                  onCancel={() => setShowFromPicker(false)}
                />
              ) : showToPicker ? (
                <TokenPicker
                  mode="to"
                  tokenHoldings={toPickerTokens}
                  tokenDetailsByMint={tokenDetailsByMint}
                  searchTokens={searchTokens}
                  onSelect={(mint) => selectToToken(mint)}
                  onCancel={() => setShowToPicker(false)}
                />
              ) : (
                <FormStep
                  fromHolding={fromHolding}
                  toHolding={toHolding}
                  tokenDetailsByMint={tokenDetailsByMint}
                  amountStr={amountStr}
                  onAmountChange={setAmountStr}
                  onPercentage={handlePercentage}
                  onFlip={handleFlip}
                  onFromPress={() => setShowFromPicker(true)}
                  onToPress={() => setShowToPicker(true)}
                  isValidAmount={amountStr.length > 0 ? isValidAmount : true}
                  fromBalance={fromBalance}
                  quote={quote}
                  outAmount={outAmount}
                  outUsd={outUsd}
                  isFetchingQuote={isFetchingQuote}
                  isFormValid={isFormValid}
                  onNext={() => {
                    Keyboard.dismiss();
                    setStep("confirm");
                  }}
                />
              )}
            </>
          )}

          {step === "confirm" && (
            <ConfirmStep
              fromHolding={fromHolding}
              toHolding={toHolding}
              amountNum={amountNum}
              outAmount={outAmount}
              outUsd={outUsd}
              quote={quote}
              isSwapping={isSwapping}
              onConfirm={handleSwap}
            />
          )}

          {step === "result" && (
            <ResultStep
              isSwapping={isSwapping}
              swapError={swapError}
              swapStage={swapStage}
              txSignature={txSignature}
              fromHolding={fromHolding}
              toHolding={toHolding}
              amountNum={amountNum}
              outAmount={outAmount}
              outUsd={outUsd}
              onDone={handleClose}
            />
          )}
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

// --- Token Selector Button ---
function TokenSelectorButton({
  holding,
  label,
  detailLogoUrl,
  onPress,
}: {
  holding: TokenHolding | null;
  label: string;
  detailLogoUrl?: string | null;
  onPress: () => void;
}) {
  const icon = holding ? getTokenIcon(holding, detailLogoUrl) : DEFAULT_TOKEN_ICON;
  const symbol = holding?.symbol ?? label;
  const isSecured = Boolean(holding?.isSecured);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Change token"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 9999,
        backgroundColor: "#fff",
        borderWidth: 1,
        borderColor: "rgba(0,0,0,0.08)",
      }}
    >
      <View style={{ position: "relative" }}>
        <Image
          source={{ uri: icon }}
          style={{ width: 20, height: 20, borderRadius: 10 }}
        />
        {isSecured ? (
          <Image
            source={shieldBadge}
            style={{
              position: "absolute",
              bottom: -3,
              right: -3,
              width: 12,
              height: 12,
            }}
          />
        ) : null}
      </View>
      <Text className="text-[14px] font-semibold text-black">{symbol}</Text>
      <ChevronDown size={14} color="#666" />
    </Pressable>
  );
}

// --- Helpers ---
function formatPriceImpactPct(raw: string | number): string {
  const n =
    typeof raw === "string" ? Number.parseFloat(raw) : Number.isFinite(raw) ? raw : NaN;
  if (!Number.isFinite(n) || n === 0) return "0%";
  const abs = Math.abs(n);
  if (abs < 0.0001) return `${n < 0 ? "-" : "<"}0.0001%`;
  const decimals = abs >= 1 ? 2 : 4;
  // Strip trailing zeros: 0.5000 → 0.5, 0.5010 → 0.501
  const trimmed = Number.parseFloat(n.toFixed(decimals)).toString();
  return `${trimmed}%`;
}

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
  tokenHoldings,
  tokenDetailsByMint,
  searchTokens,
  onSelect,
  onCancel,
}: {
  mode: "from" | "to";
  tokenHoldings: TokenHolding[];
  tokenDetailsByMint?: TokenDetailsByMint;
  searchTokens?: (query: string) => Promise<PopularToken[]>;
  onSelect: (mint: string, isSecured?: boolean) => void;
  onCancel: () => void;
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
        t.mint.toLowerCase().includes(lower),
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
    <>
      {/* Search */}
      <View className="mb-3 flex-row items-center rounded-xl border border-neutral-200 bg-neutral-50 px-3">
        <Search size={16} color="#999" />
        <BottomSheetTextInput
          style={{
            flex: 1,
            marginLeft: 8,
            paddingVertical: 12,
            fontSize: 16,
            color: "#000",
          }}
          placeholder="Search tokens"
          placeholderTextColor="#999"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* Token list */}
      {displayTokens.map((token) => {
        const icon = getTokenIcon(
          token,
          tokenDetailsByMint?.[token.mint]?.token.logoUrl,
        );
        const isSecured = Boolean(token.isSecured);
        return (
          <Pressable
            key={`${token.mint}:${isSecured ? "shielded" : "public"}`}
            className="flex-row items-center rounded-xl px-2 py-3 active:bg-neutral-100"
            onPress={() => onSelect(token.mint, isSecured)}
          >
            <View style={{ position: "relative" }}>
              <Image
                source={{ uri: icon }}
                style={{ width: 32, height: 32, borderRadius: 16 }}
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
            <View className="ml-3 flex-1">
              <Text className="text-[14px] font-medium text-black">
                {token.symbol}
                {isSecured ? " · Shielded" : ""}
              </Text>
              <Text className="text-[12px] text-neutral-500" numberOfLines={1}>
                {token.name}
              </Text>
            </View>
            {mode === "from" || token.balance > 0 ? (
              <Text className="text-[14px] text-neutral-600">
                {token.balance.toFixed(
                  token.decimals > 4 ? 4 : token.decimals,
                )}
              </Text>
            ) : null}
          </Pressable>
        );
      })}

      {/* Searching indicator */}
      {isSearching && (
        <View className="flex-row items-center justify-center py-4">
          <ActivityIndicator size="small" color="#999" />
          <Text className="ml-2 text-[14px] text-neutral-400">
            Searching...
          </Text>
        </View>
      )}

      {displayTokens.length === 0 && !isSearching && (
        <Text className="py-8 text-center text-[14px] text-neutral-400">
          No tokens found
        </Text>
      )}

      {/* Cancel */}
      <Pressable
        className="mt-2 items-center rounded-2xl bg-neutral-100 py-3"
        onPress={onCancel}
      >
        <Text className="text-[14px] font-medium text-neutral-600">Cancel</Text>
      </Pressable>
    </>
  );
}

// --- Form Step ---
function FormStep({
  fromHolding,
  toHolding,
  tokenDetailsByMint,
  amountStr,
  onAmountChange,
  onPercentage,
  onFlip,
  onFromPress,
  onToPress,
  isValidAmount,
  fromBalance,
  quote,
  outAmount,
  outUsd,
  isFetchingQuote,
  isFormValid,
  onNext,
}: {
  fromHolding: TokenHolding | null;
  toHolding: TokenHolding | null;
  tokenDetailsByMint?: TokenDetailsByMint;
  amountStr: string;
  onAmountChange: (v: string) => void;
  onPercentage: (pct: number) => void;
  onFlip: () => void;
  onFromPress: () => void;
  onToPress: () => void;
  isValidAmount: boolean;
  fromBalance: number;
  quote: JupiterQuoteResponse | null;
  outAmount: number | null;
  outUsd: number | null;
  isFetchingQuote: boolean;
  isFormValid: boolean;
  onNext: () => void;
}) {
  return (
    <>
      {/* From section */}
      <Text className="mb-1.5 text-[14px] font-medium text-neutral-700">From</Text>
      <View
        className="mb-1 flex-row items-center rounded-xl border border-neutral-200 bg-neutral-50"
        style={{ paddingRight: 6 }}
      >
        <BottomSheetTextInput
          style={{
            flex: 1,
            paddingHorizontal: 16,
            paddingVertical: 12,
            fontSize: 16,
            color: "#000",
          }}
          placeholder="0.00"
          placeholderTextColor="#999"
          value={amountStr}
          onChangeText={onAmountChange}
          keyboardType="decimal-pad"
        />
        <TokenSelectorButton
          holding={fromHolding}
          label="Select"
          detailLogoUrl={
            fromHolding
              ? tokenDetailsByMint?.[fromHolding.mint]?.token.logoUrl
              : undefined
          }
          onPress={onFromPress}
        />
      </View>
      {!isValidAmount && amountStr.length > 0 && (
        <Text className="mt-1 text-[12px] text-red-500">
          {parseFloat(amountStr) > fromBalance
            ? "Insufficient balance"
            : "Enter a valid amount"}
        </Text>
      )}
      <View className="mt-2 flex-row items-center justify-between">
        <Text className="text-[12px] text-neutral-500">
          Balance: {fromBalance.toFixed(4)} {fromHolding?.symbol ?? ""}
          {fromHolding?.priceUsd != null
            ? ` (~$${(fromBalance * (fromHolding.priceUsd ?? 0)).toFixed(2)})`
            : ""}
        </Text>
        <Pressable
          className="rounded-lg bg-neutral-200 px-2.5 py-1"
          onPress={() => onPercentage(100)}
        >
          <Text className="text-[12px] font-semibold text-neutral-700">MAX</Text>
        </Pressable>
      </View>

      {/* Flip button */}
      <View className="my-3 items-center">
        <Pressable
          className="rounded-full bg-neutral-100 p-2"
          onPress={onFlip}
        >
          <ArrowDownUp size={20} color="#000" />
        </Pressable>
      </View>

      {/* To section */}
      <Text className="mb-1.5 text-[14px] font-medium text-neutral-700">To</Text>
      <View
        className="mb-1 flex-row items-center rounded-xl border border-neutral-200 bg-neutral-50"
        style={{ paddingRight: 6 }}
      >
        <View
          className="flex-1"
          style={{ paddingHorizontal: 16, paddingVertical: 12 }}
        >
          {isFetchingQuote ? (
            <ActivityIndicator size="small" color="#999" />
          ) : outAmount != null ? (
            <Text className="text-[16px] text-black">
              {outAmount.toFixed(
                toHolding && toHolding.decimals > 4 ? 4 : (toHolding?.decimals ?? 4),
              )}
            </Text>
          ) : (
            <Text className="text-[16px] text-neutral-300">0.00</Text>
          )}
        </View>
        <TokenSelectorButton
          holding={toHolding}
          label="Select"
          detailLogoUrl={
            toHolding
              ? tokenDetailsByMint?.[toHolding.mint]?.token.logoUrl
              : undefined
          }
          onPress={onToPress}
        />
      </View>
      {outUsd !== null && (
        <Text className="mt-1 text-[12px] text-neutral-500">
          ≈ ${outUsd.toFixed(2)}
        </Text>
      )}

      {/* Quote info */}
      {quote && outAmount != null && (
        <Text className="mb-1 text-[12px] text-neutral-400">
          Price impact: {formatPriceImpactPct(quote.priceImpactPct)} | Slippage:{" "}
          {(quote.slippageBps / 100).toFixed(2)}%
        </Text>
      )}

      <View className="mb-4" />

      {/* Review button */}
      <Pressable
        className={`items-center rounded-2xl py-4 ${!isFormValid ? "opacity-40" : ""}`}
        style={{ backgroundColor: "#f9363c" }}
        onPress={onNext}
        disabled={!isFormValid}
      >
        <Text className="text-[16px] font-semibold text-white">
          Review
        </Text>
      </Pressable>
    </>
  );
}

// --- Confirm Step ---
function ConfirmStep({
  fromHolding,
  toHolding,
  amountNum,
  outAmount,
  outUsd,
  quote,
  isSwapping,
  onConfirm,
}: {
  fromHolding: TokenHolding | null;
  toHolding: TokenHolding | null;
  amountNum: number;
  outAmount: number | null;
  outUsd: number | null;
  quote: JupiterQuoteResponse | null;
  isSwapping: boolean;
  onConfirm: () => void;
}) {
  return (
    <>
      <View className="mb-6 rounded-2xl bg-neutral-50 p-4">
        <Row
          label="From"
          value={`${amountNum} ${fromHolding?.symbol ?? ""}`}
        />
        <Row
          label="To"
          value={`${outAmount?.toFixed(4) ?? "—"} ${toHolding?.symbol ?? ""}`}
        />
        <Row
          label="Est. Value"
          value={outUsd !== null ? `$${outUsd.toFixed(2)}` : "—"}
          isSubtle
        />
        {quote && (
          <>
            <Row label="Price impact" value={formatPriceImpactPct(quote.priceImpactPct)} />
            <Row
              label="Slippage tolerance"
              value={`${(quote.slippageBps / 100).toFixed(2)}%`}
            />
          </>
        )}
      </View>

      <Pressable
        className={`items-center rounded-2xl py-4 ${isSwapping ? "opacity-40" : ""}`}
        style={{ backgroundColor: "#f9363c" }}
        onPress={onConfirm}
        disabled={isSwapping}
      >
        {isSwapping ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-[16px] font-semibold text-white">
            Confirm Swap
          </Text>
        )}
      </Pressable>
    </>
  );
}

function Row({
  label,
  value,
  isSubtle = false,
}: {
  label: string;
  value: string;
  isSubtle?: boolean;
}) {
  return (
    <View className="flex-row justify-between py-1.5">
      <Text className="text-[14px] text-neutral-500">{label}</Text>
      <Text
        className={`text-[14px] ${isSubtle ? "text-neutral-400" : "font-medium text-black"}`}
      >
        {value}
      </Text>
    </View>
  );
}

// --- Result Step ---
function ResultStep({
  isSwapping,
  swapError,
  swapStage,
  txSignature,
  fromHolding,
  toHolding,
  amountNum,
  outAmount,
  outUsd,
  onDone,
}: {
  isSwapping: boolean;
  swapError: string | null;
  swapStage: "idle" | "unshielding" | "swapping";
  txSignature: string | null;
  fromHolding: TokenHolding | null;
  toHolding: TokenHolding | null;
  amountNum: number;
  outAmount: number | null;
  outUsd: number | null;
  onDone: () => void;
}) {
  if (isSwapping) {
    const primaryLabel =
      swapStage === "unshielding" ? "Unshielding funds…" : "Swapping tokens…";
    return (
      <View className="items-center py-12">
        <ActivityIndicator size="large" color="#000" />
        <Text className="mt-4 text-[16px] text-neutral-600">{primaryLabel}</Text>
        {swapStage === "unshielding" ? (
          <Text className="mt-2 text-[12px] text-neutral-400">
            Preparing public balance for the swap…
          </Text>
        ) : null}
      </View>
    );
  }

  if (swapError) {
    return (
      <View className="items-center py-8">
        <AlertCircle size={48} color="#ef4444" />
        <Text className="mt-4 text-center text-[16px] font-medium text-red-600">
          Swap Failed
        </Text>
        <Text className="mt-2 text-center text-[14px] text-neutral-500">
          {swapError}
        </Text>
        <Pressable
          className="mt-6 w-full items-center rounded-2xl py-4"
          style={{ backgroundColor: "#f9363c" }}
          onPress={onDone}
        >
          <Text className="text-[16px] font-semibold text-white">Done</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="items-center py-8">
      <CheckCircle2 size={48} color="#22c55e" />
      <Text className="mt-4 text-[16px] font-medium text-black">
        {amountNum} {fromHolding?.symbol ?? ""} swapped
      </Text>
      <Text className="mt-1 text-[14px] text-neutral-500">
        for {outAmount?.toFixed(4) ?? "—"} {toHolding?.symbol ?? ""}
      </Text>
      {outUsd !== null && (
        <Text className="mt-1 text-[13px] text-neutral-400">
          ≈ ${outUsd.toFixed(2)}
        </Text>
      )}
      {txSignature && (
        <Text className="mt-2 text-[12px] text-neutral-400" numberOfLines={1}>
          Tx: {txSignature.slice(0, 12)}...
        </Text>
      )}
      <Pressable
        className="mt-6 w-full items-center rounded-2xl bg-black py-4"
        onPress={onDone}
      >
        <Text className="text-[16px] font-semibold text-white">Done</Text>
      </Pressable>
    </View>
  );
}
