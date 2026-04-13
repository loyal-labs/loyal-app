import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import {
  CameraView,
  type BarcodeScanningResult,
  useCameraPermissions,
} from "expo-camera";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronDown } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Keyboard } from "react-native";

import { NATIVE_SOL_MINT, SOLANA_FEE_SOL } from "@/lib/solana/constants";
import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { sendPrivateTransferToTelegramUsername } from "@/lib/solana/wallet/private-send";
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

const isValidTelegramUsername = (value: string): boolean => {
  if (!value.startsWith("@")) return false;
  const usernameWithoutAt = value.slice(1);
  return (
    /^[a-zA-Z0-9_]+$/.test(usernameWithoutAt) &&
    usernameWithoutAt.length >= 5 &&
    usernameWithoutAt.length <= 32
  );
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
  initialMint?: string;
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

const SOL_ADDRESS_CANDIDATE_REGEX = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractSolanaAddressFromScan(rawData: string): string | null {
  const trimmed = rawData.trim();
  if (!trimmed) return null;

  const possibleInputs = [trimmed, safeDecodeUriComponent(trimmed)];
  const queryKeys = ["to", "address", "recipient", "pubkey"];

  for (const input of possibleInputs) {
    const solanaPrefixed = input
      .replace(/^solana:(\/\/)?/i, "")
      .split("?")[0]
      .split("#")[0];
    if (isValidSolanaAddress(solanaPrefixed)) return solanaPrefixed;

    try {
      const parsed = new URL(input);
      for (const key of queryKeys) {
        const paramValue = parsed.searchParams.get(key);
        if (!paramValue) continue;
        const normalizedValue = safeDecodeUriComponent(paramValue).trim();
        if (isValidSolanaAddress(normalizedValue)) return normalizedValue;
      }
    } catch {
      // Not a URL; continue with regex candidate scan.
    }

    const candidates = input.match(SOL_ADDRESS_CANDIDATE_REGEX) ?? [];
    for (const candidate of candidates) {
      if (isValidSolanaAddress(candidate)) return candidate;
    }
  }

  return null;
}

function toRawAmount(amount: number, decimals: number): bigint {
  const scale = 10 ** decimals;
  const scaled = Math.floor(amount * scale);
  if (!Number.isFinite(scaled) || scaled <= 0) {
    throw new Error("Enter a valid amount");
  }
  return BigInt(scaled);
}

const DIRECT_SEND_FEE_TX_COUNT = 1;
const PRIVATE_SEND_FEE_TX_COUNT = 3;

function getSendFeeReserveSol(params: { isTelegramRecipient: boolean }): number {
  return (
    (params.isTelegramRecipient ? PRIVATE_SEND_FEE_TX_COUNT : DIRECT_SEND_FEE_TX_COUNT) *
    SOLANA_FEE_SOL
  );
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

function resolveInitialSendMint(
  sendAssets: SendAsset[],
  initialMint?: string,
): string {
  if (initialMint && sendAssets.some((asset) => asset.mint === initialMint)) {
    return initialMint;
  }

  return sendAssets[0]?.mint ?? NATIVE_SOL_MINT;
}

export function SendSheet({
  open,
  onClose,
  solBalanceLamports,
  solPriceUsd,
  tokenHoldings,
  onSendComplete,
  initialMint,
}: SendSheetProps) {
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scanLockRef = useRef(false);
  const scanUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [step, setStep] = useState<SendStep>("form");
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [showTokenPicker, setShowTokenPicker] = useState(false);
  const [selectedMint, setSelectedMint] = useState<string>(NATIVE_SOL_MINT);
  const [recipient, setRecipient] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
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

  const recipientTrimmed = recipient.trim();
  const isWalletRecipient = isValidSolanaAddress(recipientTrimmed);
  const isTelegramRecipient = isValidTelegramUsername(recipientTrimmed);
  const isValidRecipient = isWalletRecipient || isTelegramRecipient;
  const isTelegramRecipientTokenSupported =
    !isTelegramRecipient || selectedAsset?.mint === NATIVE_SOL_MINT;
  const sendFeeReserveSol = getSendFeeReserveSol({ isTelegramRecipient });
  const maxSpendableInToken =
    selectedAsset?.mint === NATIVE_SOL_MINT
      ? Math.max(0, balanceInToken - sendFeeReserveSol)
      : balanceInToken;
  const minAmountInToken = selectedAsset ? 1 / (10 ** selectedAsset.decimals) : 0;
  const isValidAmount =
    !!selectedAsset &&
    amountInToken >= minAmountInToken &&
    amountInToken <= maxSpendableInToken;
  const recipientError =
    recipientTrimmed.length === 0
      ? null
      : !isValidRecipient
      ? "Enter a valid wallet address or @username"
      : !isTelegramRecipientTokenSupported
      ? "Telegram username transfers currently support SOL only."
      : null;
  const isFormValid =
    !!selectedAsset &&
    isValidRecipient &&
    isTelegramRecipientTokenSupported &&
    isValidAmount;

  useEffect(() => {
    if (sendAssets.length === 0) return;
    if (!sendAssets.some((asset) => asset.mint === selectedMint)) {
      setSelectedMint(resolveInitialSendMint(sendAssets, initialMint));
    }
  }, [initialMint, selectedMint, sendAssets]);

  useEffect(() => {
    return () => {
      if (scanUnlockTimerRef.current) {
        clearTimeout(scanUnlockTimerRef.current);
      }
    };
  }, []);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      bottomSheetRef.current?.present();
      setStep("form");
      setShowQrScanner(false);
      setShowTokenPicker(false);
      setSelectedMint(resolveInitialSendMint(sendAssets, initialMint));
      setRecipient("");
      setScanError(null);
      setAmountStr("");
      setCurrencyMode("TOKEN");
      setSendError(null);
      setTxSignature(null);
      setIsSending(false);
      scanLockRef.current = false;
      if (scanUnlockTimerRef.current) {
        clearTimeout(scanUnlockTimerRef.current);
        scanUnlockTimerRef.current = null;
      }
    } else {
      bottomSheetRef.current?.dismiss();
    }
  }, [initialMint, open, sendAssets]);

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
        isTelegramRecipient
          ? await sendPrivateTransferToTelegramUsername({
              username: recipientTrimmed,
              tokenMint: selectedAsset.mint,
              amount: amountInToken,
              decimals: selectedAsset.decimals,
            })
          : selectedAsset.mint === NATIVE_SOL_MINT
          ? await sendSolTransaction(
              recipientTrimmed,
              Math.floor(amountInToken * LAMPORTS_PER_SOL),
            )
          : await sendSplTokenTransaction(
              recipientTrimmed,
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
  }, [
    isFormValid,
    isSending,
    selectedAsset,
    isTelegramRecipient,
    recipientTrimmed,
    amountInToken,
    onSendComplete,
  ]);

  const handleClose = useCallback(() => {
    setShowQrScanner(false);
    setShowTokenPicker(false);
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

  const handleOpenQrScanner = useCallback(async () => {
    Keyboard.dismiss();
    setScanError(null);
    setShowTokenPicker(false);
    setShowQrScanner(true);

    let granted = cameraPermission?.granted ?? false;
    if (!granted) {
      const response = await requestCameraPermission();
      granted = response.granted;
    }

    if (!granted) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    scanLockRef.current = false;
    if (scanUnlockTimerRef.current) {
      clearTimeout(scanUnlockTimerRef.current);
      scanUnlockTimerRef.current = null;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [cameraPermission, requestCameraPermission]);

  const handleBarcodeScanned = useCallback(
    (event: BarcodeScanningResult) => {
      if (scanLockRef.current) return;
      scanLockRef.current = true;

      const scannedAddress = extractSolanaAddressFromScan(event.data);
      if (!scannedAddress) {
        setScanError("No valid Solana address found in that QR code.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        scanUnlockTimerRef.current = setTimeout(() => {
          scanLockRef.current = false;
          scanUnlockTimerRef.current = null;
        }, 800);
        return;
      }

      setRecipient(scannedAddress);
      setScanError(null);
      setShowQrScanner(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [],
  );

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

      const maxAmount = maxSpendableInToken;
      const val = pct === 100 ? maxAmount : maxAmount * (pct / 100);

      if (currencyMode === "TOKEN") {
        setAmountStr(val > 0 ? String(Number(val.toFixed(6))) : "");
      } else if (tokenPriceUsd) {
        setAmountStr(val > 0 ? (val * tokenPriceUsd).toFixed(2) : "");
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [selectedAsset, maxSpendableInToken, currencyMode, tokenPriceUsd],
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
    ? `~$${(sendFeeReserveSol * solPriceUsd).toFixed(4)}`
    : `${sendFeeReserveSol} SOL`;

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
            {(step === "confirm" || showTokenPicker || showQrScanner) && (
              <Pressable
                className="absolute left-0"
                onPress={() => {
                  if (showQrScanner) {
                    setShowQrScanner(false);
                    setScanError(null);
                    return;
                  }
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
              {showQrScanner
                ? "Scan QR"
                : showTokenPicker
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
              {showQrScanner ? (
                <AddressScannerStep
                  scanError={scanError}
                  onScan={handleBarcodeScanned}
                  onRequestPermission={requestCameraPermission}
                  permissionGranted={cameraPermission?.granted === true}
                  canAskPermissionAgain={cameraPermission?.canAskAgain !== false}
                />
              ) : showTokenPicker ? (
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
                  onScanRecipient={handleOpenQrScanner}
                  amountStr={amountStr}
                  onAmountChange={setAmountStr}
                  currencyMode={currencyMode}
                  onToggleCurrency={toggleCurrency}
                  onPercentage={handlePercentage}
                  maxSpendableInToken={maxSpendableInToken}
                  tokenPriceUsd={tokenPriceUsd}
                  recipientError={recipientError}
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
              recipient={recipientTrimmed}
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
              recipient={recipientTrimmed}
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
  onScanRecipient,
  amountStr,
  onAmountChange,
  currencyMode,
  onToggleCurrency,
  onPercentage,
  maxSpendableInToken,
  tokenPriceUsd,
  recipientError,
  isValidAmount,
  isFormValid,
  onNext,
}: {
  selectedAsset: SendAsset | null;
  onAssetPress: () => void;
  recipient: string;
  onRecipientChange: (v: string) => void;
  onPasteRecipient: () => void;
  onScanRecipient: () => void;
  amountStr: string;
  onAmountChange: (v: string) => void;
  currencyMode: "TOKEN" | "USD";
  onToggleCurrency: () => void;
  onPercentage: (pct: number) => void;
  maxSpendableInToken: number;
  tokenPriceUsd: number | null;
  recipientError: string | null;
  isValidAmount: boolean;
  isFormValid: boolean;
  onNext: () => void;
}) {
  return (
    <>
      {/* Recipient */}
      <View className="mb-1.5 flex-row items-center justify-between">
        <Text className="text-[14px] font-medium text-neutral-700">To</Text>
        <View className="flex-row items-center gap-2">
          <Pressable
            className="rounded-lg bg-neutral-200 px-2.5 py-1"
            onPress={onScanRecipient}
          >
            <Text className="text-[12px] font-semibold text-neutral-700">Scan</Text>
          </Pressable>
          <Pressable
            className="rounded-lg bg-neutral-200 px-2.5 py-1"
            onPress={onPasteRecipient}
          >
            <Text className="text-[12px] font-semibold text-neutral-700">Paste</Text>
          </Pressable>
        </View>
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
        placeholder="Wallet address or @username"
        placeholderTextColor="#999"
        value={recipient}
        onChangeText={onRecipientChange}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {recipientError && (
        <Text className="mb-2 text-[12px] text-red-500">{recipientError}</Text>
      )}
      {!recipientError && <View className="mb-3" />}

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
              : 0) > maxSpendableInToken
            ? "Insufficient balance"
            : "Enter a valid amount"}
        </Text>
      )}

      {/* Balance info */}
      <Text className="mb-6 text-[12px] text-neutral-400">
        Balance: {maxSpendableInToken.toFixed(4)} {selectedAsset?.symbol ?? "TOKEN"}
        {tokenPriceUsd
          ? ` (~$${(maxSpendableInToken * tokenPriceUsd).toFixed(2)})`
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

function AddressScannerStep({
  permissionGranted,
  canAskPermissionAgain,
  onRequestPermission,
  onScan,
  scanError,
}: {
  permissionGranted: boolean;
  canAskPermissionAgain: boolean;
  onRequestPermission: () => Promise<{ granted: boolean }>;
  onScan: (event: BarcodeScanningResult) => void;
  scanError: string | null;
}) {
  const handleGrantPermission = useCallback(async () => {
    await onRequestPermission();
  }, [onRequestPermission]);

  if (!permissionGranted) {
    return (
      <View className="items-center rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
        <Text className="text-center text-[14px] text-neutral-600">
          Camera access is required to scan wallet address QR codes.
        </Text>
        {canAskPermissionAgain ? (
          <Pressable
            className="mt-4 rounded-xl bg-black px-4 py-2.5"
            onPress={handleGrantPermission}
          >
            <Text className="text-[13px] font-semibold text-white">
              Grant Camera Access
            </Text>
          </Pressable>
        ) : (
          <Text className="mt-3 text-center text-[12px] text-neutral-500">
            Enable camera permission in device settings.
          </Text>
        )}
      </View>
    );
  }

  return (
    <>
      <View className="overflow-hidden rounded-2xl border border-neutral-200 bg-black">
        <CameraView
          style={{ height: 360, width: "100%" }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={onScan}
        />
      </View>
      <Text className="mt-3 text-center text-[13px] text-neutral-500">
        Align a wallet QR code inside the frame.
      </Text>
      {scanError && (
        <Text className="mt-2 text-center text-[12px] text-red-500">
          {scanError}
        </Text>
      )}
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
  const recipientDisplay =
    recipient.startsWith("@") || recipient.length <= 12
      ? recipient
      : `${recipient.slice(0, 6)}...${recipient.slice(-4)}`;

  return (
    <>
      <View className="mb-6 rounded-2xl bg-neutral-50 p-4">
        <Row label="To" value={recipientDisplay} />
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
  const recipientDisplay =
    recipient.startsWith("@") || recipient.length <= 12
      ? recipient
      : `${recipient.slice(0, 6)}...${recipient.slice(-4)}`;

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
        to {recipientDisplay}
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
