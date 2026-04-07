import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
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
import {
  DEFAULT_TOKEN_ICON,
  KNOWN_TOKEN_ICONS,
} from "@/lib/solana/token-holdings/constants";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { getWalletKeypair } from "@/lib/solana/wallet/wallet-details";
import { Pressable, Text, TextInput, View } from "@/tw";

type SwapStep = "form" | "confirm" | "result";

type SwapSheetProps = {
  open: boolean;
  onClose: () => void;
  walletAddress: string | null;
  tokenHoldings: TokenHolding[];
  solPriceUsd: number | null;
  onSwapComplete?: () => void;
};

const getDefaultUsdcMint = (): string => {
  const env = getSolanaEnv();
  return env === "mainnet" ? SOLANA_USDC_MINT_MAINNET : SOLANA_USDC_MINT_DEVNET;
};

const getTokenIcon = (holding: TokenHolding): string =>
  KNOWN_TOKEN_ICONS[holding.mint] ?? holding.imageUrl ?? DEFAULT_TOKEN_ICON;

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

export function SwapSheet({
  open,
  onClose,
  walletAddress,
  tokenHoldings,
  solPriceUsd,
  onSwapComplete,
}: SwapSheetProps) {
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

  const fromHolding = tokenHoldings.find((t) => t.mint === fromMint) ?? null;
  const toHolding = tokenHoldings.find((t) => t.mint === toMint) ?? null;

  const amountNum = parseFloat(amountStr) || 0;
  const fromBalance = fromHolding?.balance ?? 0;
  const isValidAmount = amountNum > 0 && amountNum <= fromBalance;
  const isFormValid = isValidAmount && !!quote && fromMint !== toMint;

  // Reset state when opening
  useEffect(() => {
    if (open) {
      bottomSheetRef.current?.present();
      setStep("form");
      setFromMint(NATIVE_SOL_MINT);
      setToMint(getDefaultUsdcMint());
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

  const handleFlip = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const prevFrom = fromMint;
    const prevTo = toMint;
    setFromMint(prevTo);
    setToMint(prevFrom);
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
      setAmountStr(val > 0 ? String(Number(val.toFixed(6))) : "");
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [fromHolding, fromBalance],
  );

  const handleSwap = useCallback(async () => {
    if (!isFormValid || isSwapping || !walletAddress || !quote) return;

    Keyboard.dismiss();
    setIsSwapping(true);
    setSwapError(null);
    setStep("result");

    try {
      const swapTxResponse = await getJupiterSwapTransaction({
        quoteResponse: quote,
        userPublicKey: walletAddress,
      });

      const txBuf = Buffer.from(swapTxResponse.swapTransaction, "base64");
      const transaction = VersionedTransaction.deserialize(txBuf);
      const keypair = await getWalletKeypair();
      transaction.sign([keypair]);

      const connection = getConnection();
      const sig = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 2,
      });
      await connection.confirmTransaction(sig, "confirmed");

      setTxSignature(sig);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSwapComplete?.();
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Swap failed";
      setSwapError(getFriendlyError(msg));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSwapping(false);
    }
  }, [isFormValid, isSwapping, walletAddress, quote, onSwapComplete]);

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
    (mint: string) => {
      setFromMint(mint);
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
      }
    },
    [fromMint, toMint],
  );

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      enableDynamicSizing
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
            {step === "confirm" && (
              <Pressable
                className="absolute left-0"
                onPress={() => setStep("form")}
              >
                <ArrowLeft size={24} color="#000" />
              </Pressable>
            )}
            <Text
              className="text-[17px] font-semibold text-black"
              style={{ lineHeight: 22 }}
            >
              {step === "form"
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
                  tokenHoldings={tokenHoldings}
                  onSelect={selectFromToken}
                  onCancel={() => setShowFromPicker(false)}
                />
              ) : showToPicker ? (
                <TokenPicker
                  tokenHoldings={tokenHoldings}
                  onSelect={selectToToken}
                  onCancel={() => setShowToPicker(false)}
                />
              ) : (
                <FormStep
                  fromHolding={fromHolding}
                  toHolding={toHolding}
                  amountStr={amountStr}
                  onAmountChange={setAmountStr}
                  onPercentage={handlePercentage}
                  onFlip={handleFlip}
                  onFromPress={() => setShowFromPicker(true)}
                  onToPress={() => setShowToPicker(true)}
                  isValidAmount={amountStr.length > 0 ? isValidAmount : true}
                  fromBalance={fromBalance}
                  solPriceUsd={solPriceUsd}
                  quote={quote}
                  outAmount={outAmount}
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
              quote={quote}
              isSwapping={isSwapping}
              onConfirm={handleSwap}
            />
          )}

          {step === "result" && (
            <ResultStep
              isSwapping={isSwapping}
              swapError={swapError}
              txSignature={txSignature}
              fromHolding={fromHolding}
              toHolding={toHolding}
              amountNum={amountNum}
              outAmount={outAmount}
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
  onPress,
}: {
  holding: TokenHolding | null;
  label: string;
  onPress: () => void;
}) {
  const icon = holding ? getTokenIcon(holding) : DEFAULT_TOKEN_ICON;
  const symbol = holding?.symbol ?? label;

  return (
    <Pressable
      className="flex-row items-center rounded-xl bg-neutral-100 px-3 py-2"
      onPress={onPress}
    >
      <Image
        source={{ uri: icon }}
        style={{ width: 24, height: 24, borderRadius: 12 }}
      />
      <Text className="ml-2 text-[14px] font-semibold text-black">{symbol}</Text>
      <ChevronDown size={16} color="#666" style={{ marginLeft: 4 }} />
    </Pressable>
  );
}

// --- Token Picker ---
function TokenPicker({
  tokenHoldings,
  onSelect,
  onCancel,
}: {
  tokenHoldings: TokenHolding[];
  onSelect: (mint: string) => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return tokenHoldings;
    const lower = search.toLowerCase();
    return tokenHoldings.filter(
      (t) =>
        t.symbol.toLowerCase().includes(lower) ||
        t.name.toLowerCase().includes(lower),
    );
  }, [tokenHoldings, search]);

  return (
    <>
      {/* Search */}
      <View className="mb-3 flex-row items-center rounded-xl border border-neutral-200 bg-neutral-50 px-3">
        <Search size={16} color="#999" />
        <TextInput
          className="ml-2 flex-1 py-3 text-[16px] text-black"
          placeholder="Search tokens"
          placeholderTextColor="#999"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* Token list */}
      {filtered.map((token) => {
        const icon = getTokenIcon(token);
        return (
          <Pressable
            key={token.mint}
            className="flex-row items-center rounded-xl px-2 py-3 active:bg-neutral-100"
            onPress={() => onSelect(token.mint)}
          >
            <Image
              source={{ uri: icon }}
              style={{ width: 32, height: 32, borderRadius: 16 }}
            />
            <View className="ml-3 flex-1">
              <Text className="text-[14px] font-medium text-black">
                {token.symbol}
              </Text>
              <Text className="text-[12px] text-neutral-500" numberOfLines={1}>
                {token.name}
              </Text>
            </View>
            <Text className="text-[14px] text-neutral-600">
              {token.balance.toFixed(token.decimals > 4 ? 4 : token.decimals)}
            </Text>
          </Pressable>
        );
      })}

      {filtered.length === 0 && (
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
  amountStr,
  onAmountChange,
  onPercentage,
  onFlip,
  onFromPress,
  onToPress,
  isValidAmount,
  fromBalance,
  solPriceUsd,
  quote,
  outAmount,
  isFetchingQuote,
  isFormValid,
  onNext,
}: {
  fromHolding: TokenHolding | null;
  toHolding: TokenHolding | null;
  amountStr: string;
  onAmountChange: (v: string) => void;
  onPercentage: (pct: number) => void;
  onFlip: () => void;
  onFromPress: () => void;
  onToPress: () => void;
  isValidAmount: boolean;
  fromBalance: number;
  solPriceUsd: number | null;
  quote: JupiterQuoteResponse | null;
  outAmount: number | null;
  isFetchingQuote: boolean;
  isFormValid: boolean;
  onNext: () => void;
}) {
  return (
    <>
      {/* From section */}
      <Text className="mb-1.5 text-[14px] font-medium text-neutral-700">From</Text>
      <View className="mb-1 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
        <View className="flex-row items-center">
          <TokenSelectorButton
            holding={fromHolding}
            label="Select"
            onPress={onFromPress}
          />
          <TextInput
            className="ml-3 flex-1 text-right text-[18px] text-black"
            placeholder="0.00"
            placeholderTextColor="#999"
            value={amountStr}
            onChangeText={onAmountChange}
            keyboardType="decimal-pad"
          />
          <View className="ml-2 flex-row gap-1.5">
            <Pressable className="rounded-lg bg-neutral-200 px-2 py-1" onPress={() => onPercentage(25)}>
              <Text className="text-[11px] font-semibold text-neutral-700">25%</Text>
            </Pressable>
            <Pressable className="rounded-lg bg-neutral-200 px-2 py-1" onPress={() => onPercentage(50)}>
              <Text className="text-[11px] font-semibold text-neutral-700">50%</Text>
            </Pressable>
            <Pressable className="rounded-lg bg-neutral-200 px-2 py-1" onPress={() => onPercentage(100)}>
              <Text className="text-[11px] font-semibold text-neutral-700">MAX</Text>
            </Pressable>
          </View>
        </View>
        <Text className="mt-1 text-[12px] text-neutral-400">
          Balance: {fromBalance.toFixed(4)} {fromHolding?.symbol ?? ""}
          {fromHolding?.valueUsd != null && solPriceUsd
            ? ` (~$${(fromBalance * (fromHolding.priceUsd ?? 0)).toFixed(2)})`
            : ""}
        </Text>
      </View>
      {!isValidAmount && amountStr.length > 0 && (
        <Text className="mb-1 text-[12px] text-red-500">
          {parseFloat(amountStr) > fromBalance
            ? "Insufficient balance"
            : "Enter a valid amount"}
        </Text>
      )}

      {/* Flip button */}
      <View className="my-2 items-center">
        <Pressable
          className="rounded-full bg-neutral-100 p-2"
          onPress={onFlip}
        >
          <ArrowDownUp size={20} color="#000" />
        </Pressable>
      </View>

      {/* To section */}
      <Text className="mb-1.5 text-[14px] font-medium text-neutral-700">To</Text>
      <View className="mb-1 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
        <View className="flex-row items-center">
          <TokenSelectorButton
            holding={toHolding}
            label="Select"
            onPress={onToPress}
          />
          <View className="ml-3 flex-1 items-end">
            {isFetchingQuote ? (
              <ActivityIndicator size="small" color="#999" />
            ) : outAmount != null ? (
              <Text className="text-[18px] text-black">
                {outAmount.toFixed(
                  toHolding && toHolding.decimals > 4 ? 4 : (toHolding?.decimals ?? 4),
                )}
              </Text>
            ) : (
              <Text className="text-[18px] text-neutral-300">0.00</Text>
            )}
          </View>
        </View>
      </View>

      {/* Quote info */}
      {quote && outAmount != null && (
        <Text className="mb-1 text-[12px] text-neutral-400">
          Price impact: {quote.priceImpactPct}% | Slippage:{" "}
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
  quote,
  isSwapping,
  onConfirm,
}: {
  fromHolding: TokenHolding | null;
  toHolding: TokenHolding | null;
  amountNum: number;
  outAmount: number | null;
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
        {quote && (
          <>
            <Row label="Price impact" value={`${quote.priceImpactPct}%`} />
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
  txSignature,
  fromHolding,
  toHolding,
  amountNum,
  outAmount,
  onDone,
}: {
  isSwapping: boolean;
  swapError: string | null;
  txSignature: string | null;
  fromHolding: TokenHolding | null;
  toHolding: TokenHolding | null;
  amountNum: number;
  outAmount: number | null;
  onDone: () => void;
}) {
  if (isSwapping) {
    return (
      <View className="items-center py-12">
        <ActivityIndicator size="large" color="#000" />
        <Text className="mt-4 text-[16px] text-neutral-600">
          Swapping tokens...
        </Text>
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
