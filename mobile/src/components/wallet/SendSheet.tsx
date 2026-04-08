import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronDown } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Keyboard } from "react-native";

import { NATIVE_SOL_MINT, SOLANA_FEE_SOL } from "@/lib/solana/constants";
import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { sendSolTransaction, sendSplTokenTransaction } from "@/lib/solana/wallet/wallet-details";
import { Pressable, Text, View } from "@/tw";

// Basic Solana address validation (base58, 32-44 chars)
const isValidSolanaAddress = (address: string): boolean => {
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  if (!base58Regex.test(address)) return false;
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
};

function getFriendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("insufficient lamports") || lower.includes("not enough sol"))
    return "You don't have enough SOL to complete this transaction.";
  if (lower.includes("insufficient funds"))
    return "Insufficient funds for this transaction.";
  if (lower.includes("blockhash not found") || lower.includes("block height exceeded"))
    return "The transaction expired. Please try again.";
  if (lower.includes("timeout") || lower.includes("timed out"))
    return "The transaction timed out. Please try again.";
  if (raw.length > 120) return "Something went wrong. Please try again.";
  return raw;
}

type SendStep = "form" | "confirm" | "result";

type SendSheetProps = {
  open: boolean;
  onClose: () => void;
  solBalanceLamports: number | null;
  solPriceUsd: number | null;
  tokenHoldings: TokenHolding[];
  onSendComplete?: () => void;
};

type SendAsset = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: number;
  priceUsd: number | null;
  imageUrl: string | null;
};

function toRawAmount(amount: number, decimals: number): bigint {
  const scale = 10 ** decimals;
  const scaled = Math.floor(amount * scale);
  if (!Number.isFinite(scaled) || scaled <= 0) {
    throw new Error("Enter a valid amount");
  }
  return BigInt(scaled);
}

function buildSendAssets(
  tokenHoldings: TokenHolding[],
  solBalanceLamports: number | null,
  solPriceUsd: number | null,
): SendAsset[] {
  const assetsByMint = new Map<string, SendAsset>();
  const publicHoldings = tokenHoldings.filter(
    (holding) => !holding.isSecured && holding.balance > 0,
  );

  for (const holding of publicHoldings) {
    const existing = assetsByMint.get(holding.mint);
    const candidate: SendAsset = {
      mint: holding.mint,
      symbol: holding.symbol || "TOKEN",
      name: holding.name || holding.symbol || "Token",
      decimals: holding.decimals,
      balance: holding.balance,
      priceUsd: holding.priceUsd,
      imageUrl: holding.imageUrl,
    };

    if (!existing || candidate.balance > existing.balance) {
      assetsByMint.set(holding.mint, candidate);
    }
  }

  const solBalance = solBalanceLamports ? solBalanceLamports / LAMPORTS_PER_SOL : 0;
  if (solBalance > 0) {
    const existingSol = assetsByMint.get(NATIVE_SOL_MINT);
    assetsByMint.set(NATIVE_SOL_MINT, {
      mint: NATIVE_SOL_MINT,
      symbol: existingSol?.symbol || "SOL",
      name: existingSol?.name || "Solana",
      decimals: 9,
      balance: solBalance,
      priceUsd: existingSol?.priceUsd ?? solPriceUsd,
      imageUrl: existingSol?.imageUrl ?? null,
    });
  }

  return [...assetsByMint.values()].sort((a, b) => {
    const aUsd = (a.priceUsd ?? 0) * a.balance;
    const bUsd = (b.priceUsd ?? 0) * b.balance;
    if (bUsd !== aUsd) return bUsd - aUsd;
    return a.symbol.localeCompare(b.symbol);
  });
}

export function SendSheet({
  open,
  onClose,
  solBalanceLamports,
  solPriceUsd,
  tokenHoldings,
  onSendComplete,
}: SendSheetProps) {
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const [step, setStep] = useState<SendStep>("form");
  const [showTokenPicker, setShowTokenPicker] = useState(false);
  const [selectedMint, setSelectedMint] = useState<string>(NATIVE_SOL_MINT);
  const [recipient, setRecipient] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [currencyMode, setCurrencyMode] = useState<"TOKEN" | "USD">("TOKEN");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const sendAssets = useMemo(
    () => buildSendAssets(tokenHoldings, solBalanceLamports, solPriceUsd),
    [tokenHoldings, solBalanceLamports, solPriceUsd],
  );
  const selectedAsset = useMemo(() => {
    return (
      sendAssets.find((asset) => asset.mint === selectedMint) ??
      sendAssets[0] ??
      null
    );
  }, [sendAssets, selectedMint]);
  const tokenPriceUsd = selectedAsset?.priceUsd ?? null;
  const balanceInToken = selectedAsset?.balance ?? 0;

  const amountNum = parseFloat(amountStr) || 0;
  const amountInToken =
    currencyMode === "TOKEN"
      ? amountNum
      : tokenPriceUsd
        ? amountNum / tokenPriceUsd
        : 0;
  const amountInUsd =
    currencyMode === "USD"
      ? amountNum
      : tokenPriceUsd
        ? amountNum * tokenPriceUsd
        : 0;

  const minAmountInToken = selectedAsset ? 1 / (10 ** selectedAsset.decimals) : 0;
  const isValidRecipient = isValidSolanaAddress(recipient.trim());
  const isValidAmount =
    !!selectedAsset &&
    amountInToken >= minAmountInToken &&
    amountInToken <= balanceInToken;
  const isFormValid = !!selectedAsset && isValidRecipient && isValidAmount;

  useEffect(() => {
    if (sendAssets.length === 0) return;
    if (!sendAssets.some((asset) => asset.mint === selectedMint)) {
      setSelectedMint(sendAssets[0].mint);
    }
  }, [sendAssets, selectedMint]);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      bottomSheetRef.current?.present();
      setStep("form");
      setShowTokenPicker(false);
      setSelectedMint(NATIVE_SOL_MINT);
      setRecipient("");
      setAmountStr("");
      setCurrencyMode("TOKEN");
      setSendError(null);
      setTxSignature(null);
      setIsSending(false);
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [open]);

  const handleSend = useCallback(async () => {
    if (!isFormValid || isSending) return;

    Keyboard.dismiss();
    setIsSending(true);
    setSendError(null);
    setStep("result");

    try {
      if (!selectedAsset) {
        throw new Error("No available token balance");
      }

      const sig =
        selectedAsset.mint === NATIVE_SOL_MINT
          ? await sendSolTransaction(
              recipient.trim(),
              Math.floor(amountInToken * LAMPORTS_PER_SOL),
            )
          : await sendSplTokenTransaction(
              recipient.trim(),
              selectedAsset.mint,
              toRawAmount(amountInToken, selectedAsset.decimals),
              selectedAsset.decimals,
            );
      setTxSignature(sig);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSendComplete?.();
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Transaction failed";
      setSendError(getFriendlyError(msg));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSending(false);
    }
  }, [isFormValid, isSending, selectedAsset, amountInToken, recipient, onSendComplete]);

  const handleClose = useCallback(() => {
    bottomSheetRef.current?.dismiss();
    onClose();
  }, [onClose]);

  const toggleCurrency = useCallback(() => {
    if (!tokenPriceUsd) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currencyMode === "TOKEN") {
      const usd = amountNum * tokenPriceUsd;
      setCurrencyMode("USD");
      setAmountStr(usd > 0 ? usd.toFixed(2) : "");
    } else {
      const tokenAmount = amountNum / tokenPriceUsd;
      setCurrencyMode("TOKEN");
      setAmountStr(tokenAmount > 0 ? String(Number(tokenAmount.toFixed(6))) : "");
    }
  }, [currencyMode, amountNum, tokenPriceUsd]);

  const handlePasteRecipient = useCallback(async () => {
    const pasted = await Clipboard.getStringAsync();
    const normalized = pasted.replace(/\s+/g, "");
    if (!normalized) return;
    setRecipient(normalized);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleSelectAsset = useCallback((mint: string) => {
    setSelectedMint(mint);
    setShowTokenPicker(false);
    setAmountStr("");
    setCurrencyMode("TOKEN");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handlePercentage = useCallback(
    (pct: number) => {
      if (!selectedAsset) return;

      let maxAmount = balanceInToken;
      if (selectedAsset.mint === NATIVE_SOL_MINT) {
        maxAmount = Math.max(0, balanceInToken - SOLANA_FEE_SOL);
      }
      const val = pct === 100 ? maxAmount : maxAmount * (pct / 100);

      if (currencyMode === "TOKEN") {
        setAmountStr(val > 0 ? String(Number(val.toFixed(6))) : "");
      } else if (tokenPriceUsd) {
        setAmountStr(val > 0 ? (val * tokenPriceUsd).toFixed(2) : "");
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [selectedAsset, balanceInToken, currencyMode, tokenPriceUsd],
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

  const feeDisplay = solPriceUsd
    ? `~$${(SOLANA_FEE_SOL * solPriceUsd).toFixed(4)}`
    : `${SOLANA_FEE_SOL} SOL`;

  return (
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={["92%"]}
      enablePanDownToClose={step !== "result" || !isSending}
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
            {(step === "confirm" || showTokenPicker) && (
              <Pressable
                className="absolute left-0"
                onPress={() => {
                  if (showTokenPicker) {
                    setShowTokenPicker(false);
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
              {showTokenPicker
                ? "Select Token"
                : step === "form"
                ? "Send"
                : step === "confirm"
                  ? "Confirm"
                  : ""}
            </Text>
          </View>

          {step === "form" && (
            <>
              {showTokenPicker ? (
                <TokenPicker
                  assets={sendAssets}
                  onSelect={handleSelectAsset}
                  onCancel={() => setShowTokenPicker(false)}
                />
              ) : (
                <FormStep
                  selectedAsset={selectedAsset}
                  onAssetPress={() => setShowTokenPicker(true)}
                  recipient={recipient}
                  onRecipientChange={setRecipient}
                  onPasteRecipient={handlePasteRecipient}
                  amountStr={amountStr}
                  onAmountChange={setAmountStr}
                  currencyMode={currencyMode}
                  onToggleCurrency={toggleCurrency}
                  onPercentage={handlePercentage}
                  balanceInToken={balanceInToken}
                  tokenPriceUsd={tokenPriceUsd}
                  isValidRecipient={recipient.trim().length > 0 ? isValidRecipient : true}
                  isValidAmount={amountStr.length > 0 ? isValidAmount : true}
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
              recipient={recipient}
              amountInToken={amountInToken}
              tokenSymbol={selectedAsset?.symbol ?? "TOKEN"}
              amountInUsd={amountInUsd}
              feeDisplay={feeDisplay}
              isSending={isSending}
              onConfirm={handleSend}
            />
          )}

          {step === "result" && (
            <ResultStep
              isSending={isSending}
              sendError={sendError}
              txSignature={txSignature}
              amountInToken={amountInToken}
              tokenSymbol={selectedAsset?.symbol ?? "TOKEN"}
              recipient={recipient}
              onDone={handleClose}
            />
          )}
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

// --- Form Step ---
function FormStep({
  selectedAsset,
  onAssetPress,
  recipient,
  onRecipientChange,
  onPasteRecipient,
  amountStr,
  onAmountChange,
  currencyMode,
  onToggleCurrency,
  onPercentage,
  balanceInToken,
  tokenPriceUsd,
  isValidRecipient,
  isValidAmount,
  isFormValid,
  onNext,
}: {
  selectedAsset: SendAsset | null;
  onAssetPress: () => void;
  recipient: string;
  onRecipientChange: (v: string) => void;
  onPasteRecipient: () => void;
  amountStr: string;
  onAmountChange: (v: string) => void;
  currencyMode: "TOKEN" | "USD";
  onToggleCurrency: () => void;
  onPercentage: (pct: number) => void;
  balanceInToken: number;
  tokenPriceUsd: number | null;
  isValidRecipient: boolean;
  isValidAmount: boolean;
  isFormValid: boolean;
  onNext: () => void;
}) {
  return (
    <>
      {/* Recipient */}
      <View className="mb-1.5 flex-row items-center justify-between">
        <Text className="text-[14px] font-medium text-neutral-700">To</Text>
        <Pressable
          className="rounded-lg bg-neutral-200 px-2.5 py-1"
          onPress={onPasteRecipient}
        >
          <Text className="text-[12px] font-semibold text-neutral-700">Paste</Text>
        </Pressable>
      </View>
      <BottomSheetTextInput
        style={{
          marginBottom: 4,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "rgba(0,0,0,0.1)",
          backgroundColor: "rgb(250,250,250)",
          paddingHorizontal: 16,
          paddingVertical: 12,
          fontSize: 16,
          color: "#000",
        }}
        placeholder="Wallet address"
        placeholderTextColor="#999"
        value={recipient}
        onChangeText={onRecipientChange}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {!isValidRecipient && (
        <Text className="mb-2 text-[12px] text-red-500">Invalid Solana address</Text>
      )}
      {isValidRecipient && <View className="mb-3" />}

      {/* Asset */}
      <Text className="mb-1.5 text-[14px] font-medium text-neutral-700">Asset</Text>
      <View className="mb-3">
        <TokenSelectorButton
          asset={selectedAsset}
          onPress={onAssetPress}
        />
      </View>

      {/* Amount */}
      <Text className="mb-1.5 text-[14px] font-medium text-neutral-700">
        Amount
      </Text>
      <View className="mb-1 flex-row items-center rounded-xl border border-neutral-200 bg-neutral-50">
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
        <Pressable
          className="px-2 py-1"
          onPress={onToggleCurrency}
          disabled={!tokenPriceUsd}
        >
          <Text className="text-[14px] font-medium text-neutral-600">
            {currencyMode === "TOKEN" ? (selectedAsset?.symbol ?? "TOKEN") : "USD"}
          </Text>
        </Pressable>
        <View className="mr-3">
          <Pressable className="rounded-lg bg-neutral-200 px-2.5 py-1" onPress={() => onPercentage(100)}>
            <Text className="text-[12px] font-semibold text-neutral-700">MAX</Text>
          </Pressable>
        </View>
      </View>
      {!isValidAmount && amountStr.length > 0 && (
        <Text className="mb-2 text-[12px] text-red-500">
          {(currencyMode === "TOKEN"
            ? parseFloat(amountStr)
            : tokenPriceUsd
              ? parseFloat(amountStr) / tokenPriceUsd
              : 0) > balanceInToken
            ? "Insufficient balance"
            : "Enter a valid amount"}
        </Text>
      )}

      {/* Balance info */}
      <Text className="mb-6 text-[12px] text-neutral-400">
        Balance: {balanceInToken.toFixed(4)} {selectedAsset?.symbol ?? "TOKEN"}
        {tokenPriceUsd
          ? ` (~$${(balanceInToken * tokenPriceUsd).toFixed(2)})`
          : ""}
      </Text>

      {/* Next button */}
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

function TokenSelectorButton({
  asset,
  onPress,
}: {
  asset: SendAsset | null;
  onPress: () => void;
}) {
  const icon = resolveTokenIcon({ mint: asset?.mint ?? NATIVE_SOL_MINT, imageUrl: asset?.imageUrl });
  return (
    <Pressable
      className="flex-row items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3"
      onPress={onPress}
    >
      <View className="flex-row items-center">
        <Image
          source={{ uri: icon }}
          style={{ width: 28, height: 28, borderRadius: 14 }}
        />
        <View className="ml-2.5">
          <Text className="text-[14px] font-semibold text-black">
            {asset?.symbol ?? "Select token"}
          </Text>
          <Text className="text-[12px] text-neutral-500">
            {asset?.name ?? "Available tokens"}
          </Text>
        </View>
      </View>
      <ChevronDown size={16} color="#666" />
    </Pressable>
  );
}

function TokenPicker({
  assets,
  onSelect,
  onCancel,
}: {
  assets: SendAsset[];
  onSelect: (mint: string) => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState("");

  const filteredAssets = useMemo(() => {
    if (!search.trim()) return assets;
    const lower = search.toLowerCase();
    return assets.filter((asset) =>
      asset.symbol.toLowerCase().includes(lower) ||
      asset.name.toLowerCase().includes(lower) ||
      asset.mint.toLowerCase().includes(lower),
    );
  }, [assets, search]);

  return (
    <>
      <View className="mb-3 flex-row items-center rounded-xl border border-neutral-200 bg-neutral-50 px-3">
        <BottomSheetTextInput
          style={{
            flex: 1,
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

      {filteredAssets.map((asset) => {
        const icon = resolveTokenIcon({ mint: asset.mint, imageUrl: asset.imageUrl });
        return (
          <Pressable
            key={asset.mint}
            className="flex-row items-center rounded-xl px-2 py-3 active:bg-neutral-100"
            onPress={() => onSelect(asset.mint)}
          >
            <Image
              source={{ uri: icon }}
              style={{ width: 32, height: 32, borderRadius: 16 }}
            />
            <View className="ml-3 flex-1">
              <Text className="text-[14px] font-medium text-black">
                {asset.symbol}
              </Text>
              <Text className="text-[12px] text-neutral-500" numberOfLines={1}>
                {asset.name}
              </Text>
            </View>
            <Text className="text-[14px] text-neutral-600">
              {asset.balance.toFixed(asset.decimals > 4 ? 4 : asset.decimals)}
            </Text>
          </Pressable>
        );
      })}

      {filteredAssets.length === 0 && (
        <Text className="py-8 text-center text-[14px] text-neutral-400">
          No tokens found
        </Text>
      )}

      <Pressable
        className="mt-2 items-center rounded-2xl bg-neutral-100 py-3"
        onPress={onCancel}
      >
        <Text className="text-[14px] font-medium text-neutral-600">Cancel</Text>
      </Pressable>
    </>
  );
}

// --- Confirm Step ---
function ConfirmStep({
  recipient,
  amountInToken,
  tokenSymbol,
  amountInUsd,
  feeDisplay,
  isSending,
  onConfirm,
}: {
  recipient: string;
  amountInToken: number;
  tokenSymbol: string;
  amountInUsd: number;
  feeDisplay: string;
  isSending: boolean;
  onConfirm: () => void;
}) {
  const shortAddr = `${recipient.slice(0, 6)}...${recipient.slice(-4)}`;

  return (
    <>
      <View className="mb-6 rounded-2xl bg-neutral-50 p-4">
        <Row label="To" value={shortAddr} />
        <Row label="Amount" value={`${amountInToken.toFixed(4)} ${tokenSymbol}`} />
        {amountInUsd > 0 && (
          <Row label="" value={`~$${amountInUsd.toFixed(2)}`} isSubtle />
        )}
        <Row label="Network fee" value={feeDisplay} />
      </View>

      <Pressable
        className={`items-center rounded-2xl py-4 ${isSending ? "opacity-40" : ""}`}
        style={{ backgroundColor: "#f9363c" }}
        onPress={onConfirm}
        disabled={isSending}
      >
        {isSending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-[16px] font-semibold text-white">
            Confirm and Send
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
  isSending,
  sendError,
  txSignature,
  amountInToken,
  tokenSymbol,
  recipient,
  onDone,
}: {
  isSending: boolean;
  sendError: string | null;
  txSignature: string | null;
  amountInToken: number;
  tokenSymbol: string;
  recipient: string;
  onDone: () => void;
}) {
  if (isSending) {
    return (
      <View className="items-center py-12">
        <ActivityIndicator size="large" color="#000" />
        <Text className="mt-4 text-[16px] text-neutral-600">
          Sending transaction...
        </Text>
      </View>
    );
  }

  if (sendError) {
    return (
      <View className="items-center py-8">
        <AlertCircle size={48} color="#ef4444" />
        <Text className="mt-4 text-center text-[16px] font-medium text-red-600">
          Transaction Failed
        </Text>
        <Text className="mt-2 text-center text-[14px] text-neutral-500">
          {sendError}
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
        {amountInToken.toFixed(4)} {tokenSymbol} sent
      </Text>
      <Text className="mt-1 text-[14px] text-neutral-500">
        to {recipient.slice(0, 6)}...{recipient.slice(-4)}
      </Text>
      {txSignature && (
        <Text className="mt-2 text-[12px] text-neutral-400" numberOfLines={1}>
          Tx: {txSignature.slice(0, 12)}...
        </Text>
      )}
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
