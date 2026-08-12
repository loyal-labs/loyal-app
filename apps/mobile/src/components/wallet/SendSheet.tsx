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
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  ScanLine,
  ShieldCheck,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Modal,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useShield } from "@/hooks/wallet/useShield";
import { track } from "@/lib/analytics/analytics";
import { getSendMethod, SEND_EVENTS } from "@/lib/analytics/send-events";
import { NATIVE_SOL_MINT, SOLANA_FEE_SOL } from "@/lib/solana/constants";
import type { TokenDetailsByMint } from "@/hooks/wallet/useTokenDetails";
import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import {
  sendPrivateTransferToTelegramUsername,
  sendPrivateTransferToWallet,
} from "@/lib/solana/wallet/private-send";
import { sendSolTransaction, sendSplTokenTransaction } from "@/lib/solana/wallet/wallet-details";
import { useSignApproval, withConfirmation } from "@/lib/wallet/sign-approval";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, Text, View } from "@/tw";

const shieldBadge = require("../../../assets/images/shield-badge.png");

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
  tokenDetailsByMint?: TokenDetailsByMint;
  onSendComplete?: () => void;
  initialMint?: string;
};

type SendAsset = {
  key: string;
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: number;
  priceUsd: number | null;
  imageUrl: string | null;
  isSecured: boolean;
};

function buildSendAssetKey(mint: string, isSecured: boolean): string {
  return `${mint}:${isSecured ? "shielded" : "public"}`;
}

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
  const assetsByKey = new Map<string, SendAsset>();
  const eligibleHoldings = tokenHoldings.filter(
    (holding) => holding.balance > 0,
  );

  for (const holding of eligibleHoldings) {
    const isSecured = Boolean(holding.isSecured);
    const key = buildSendAssetKey(holding.mint, isSecured);
    const existing = assetsByKey.get(key);
    const candidate: SendAsset = {
      key,
      mint: holding.mint,
      symbol: holding.symbol || "TOKEN",
      name: holding.name || holding.symbol || "Token",
      decimals: holding.decimals,
      balance: holding.balance,
      priceUsd: holding.priceUsd,
      imageUrl: holding.imageUrl,
      isSecured,
    };

    if (!existing || candidate.balance > existing.balance) {
      assetsByKey.set(key, candidate);
    }
  }

  // Native SOL public balance comes from the wallet balance, not holdings.
  const solBalance = solBalanceLamports ? solBalanceLamports / LAMPORTS_PER_SOL : 0;
  if (solBalance > 0) {
    const publicSolKey = buildSendAssetKey(NATIVE_SOL_MINT, false);
    const existingSol = assetsByKey.get(publicSolKey);
    assetsByKey.set(publicSolKey, {
      key: publicSolKey,
      mint: NATIVE_SOL_MINT,
      symbol: existingSol?.symbol || "SOL",
      name: existingSol?.name || "Solana",
      decimals: 9,
      balance: solBalance,
      priceUsd: existingSol?.priceUsd ?? solPriceUsd,
      imageUrl: existingSol?.imageUrl ?? null,
      isSecured: false,
    });
  }

  return [...assetsByKey.values()].sort((a, b) => {
    const aUsd = (a.priceUsd ?? 0) * a.balance;
    const bUsd = (b.priceUsd ?? 0) * b.balance;
    if (bUsd !== aUsd) return bUsd - aUsd;
    if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
    return a.isSecured ? 1 : -1;
  });
}

function resolveInitialSendKey(
  sendAssets: SendAsset[],
  initialMint?: string,
): string {
  if (initialMint) {
    const publicMatch = sendAssets.find(
      (asset) => asset.mint === initialMint && !asset.isSecured,
    );
    if (publicMatch) return publicMatch.key;
    const anyMatch = sendAssets.find((asset) => asset.mint === initialMint);
    if (anyMatch) return anyMatch.key;
  }

  return sendAssets[0]?.key ?? buildSendAssetKey(NATIVE_SOL_MINT, false);
}

export function SendSheet({
  open,
  onClose,
  solBalanceLamports,
  solPriceUsd,
  tokenHoldings,
  tokenDetailsByMint,
  onSendComplete,
  initialMint,
}: SendSheetProps) {
  const { signer } = useWallet();
  const signApproval = useSignApproval();
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scanLockRef = useRef(false);
  const scanUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [step, setStep] = useState<SendStep>("form");
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [showTokenPicker, setShowTokenPicker] = useState(false);
  const [selectedAssetKey, setSelectedAssetKey] = useState<string>(
    buildSendAssetKey(NATIVE_SOL_MINT, false),
  );
  const [recipient, setRecipient] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [currencyMode, setCurrencyMode] = useState<"TOKEN" | "USD">("TOKEN");
  const [isPrivate, setIsPrivate] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [sendStage, setSendStage] = useState<
    "idle" | "unshielding" | "sending"
  >("idle");

  const { executeUnshield } = useShield();

  const sendAssets = useMemo(
    () => buildSendAssets(tokenHoldings, solBalanceLamports, solPriceUsd),
    [tokenHoldings, solBalanceLamports, solPriceUsd],
  );
  const selectedAsset = useMemo(() => {
    return (
      sendAssets.find((asset) => asset.key === selectedAssetKey) ??
      sendAssets[0] ??
      null
    );
  }, [sendAssets, selectedAssetKey]);
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
  // Telegram recipients are always private. Wallet recipients honor the
  // user toggle. Selecting a shielded source from the picker doesn't
  // imply private — that just controls which balance gets debited.
  const effectivePrivate = isTelegramRecipient || isPrivate;
  const sendFeeReserveSol = getSendFeeReserveSol({
    isTelegramRecipient: effectivePrivate,
  });
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
      : null;
  const isFormValid =
    !!selectedAsset && isValidRecipient && isValidAmount;

  useEffect(() => {
    if (sendAssets.length === 0) return;
    if (!sendAssets.some((asset) => asset.key === selectedAssetKey)) {
      setSelectedAssetKey(resolveInitialSendKey(sendAssets, initialMint));
    }
  }, [initialMint, selectedAssetKey, sendAssets]);

  useEffect(() => {
    return () => {
      if (scanUnlockTimerRef.current) {
        clearTimeout(scanUnlockTimerRef.current);
      }
    };
  }, []);

  // Reset state on open/close transitions. Other derived inputs (sendAssets,
  // initialMint) are intentionally read at open time — re-running the reset
  // mid-flight would clobber the result step after onSendComplete refreshes
  // holdings.
  useEffect(() => {
    if (open) {
      bottomSheetRef.current?.present();
      setStep("form");
      setShowQrScanner(false);
      setShowTokenPicker(false);
      setSelectedAssetKey(resolveInitialSendKey(sendAssets, initialMint));
      setRecipient("");
      setScanError(null);
      setAmountStr("");
      setCurrencyMode("TOKEN");
      setIsPrivate(false);
      setSendStage("idle");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      // A private send (toggle on, or any telegram recipient) drains the
      // user's ephemeral/shielded balance natively — no separate unshield
      // step needed. A public send from a shielded source must unshield
      // first to materialize the funds in the public token account.
      const requiresExplicitUnshield =
        selectedAsset.isSecured && !effectivePrivate;

      if (requiresExplicitUnshield) {
        setSendStage("unshielding");
        const unshieldResult = await executeUnshield({
          tokenSymbol: selectedAsset.symbol,
          amount: amountInToken,
          tokenMint: selectedAsset.mint,
          tokenDecimals: selectedAsset.decimals,
        });
        if (!unshieldResult.success) {
          throw new Error(unshieldResult.error ?? "Unshield failed");
        }
      }

      setSendStage("sending");

      if (!signer) {
        throw new Error("Wallet signer is not available");
      }
      const recipientLabel = isTelegramRecipient
        ? recipientTrimmed
        : `${recipientTrimmed.slice(0, 4)}…${recipientTrimmed.slice(-4)}`;
      const confirmingSigner = withConfirmation(signer, signApproval, {
        title: `Send ${amountInToken} ${selectedAsset.symbol}`,
        subtitle: effectivePrivate
          ? `Private transfer to ${recipientLabel}`
          : `To ${recipientLabel}`,
      });

      let sig: string;
      if (effectivePrivate) {
        sig = isTelegramRecipient
          ? await sendPrivateTransferToTelegramUsername({
              username: recipientTrimmed,
              tokenMint: selectedAsset.mint,
              amount: amountInToken,
              decimals: selectedAsset.decimals,
              signer: confirmingSigner,
            })
          : await sendPrivateTransferToWallet({
              destination: recipientTrimmed,
              tokenMint: selectedAsset.mint,
              amount: amountInToken,
              decimals: selectedAsset.decimals,
              signer: confirmingSigner,
            });
      } else if (selectedAsset.mint === NATIVE_SOL_MINT) {
        sig = await sendSolTransaction(
          recipientTrimmed,
          Math.floor(amountInToken * LAMPORTS_PER_SOL),
          confirmingSigner,
        );
      } else {
        sig = await sendSplTokenTransaction(
          recipientTrimmed,
          selectedAsset.mint,
          toRawAmount(amountInToken, selectedAsset.decimals),
          selectedAsset.decimals,
          confirmingSigner,
        );
      }

      setTxSignature(sig);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      track(SEND_EVENTS.sendFunds, {
        method: getSendMethod(recipientTrimmed),
        is_private: effectivePrivate,
        from_shielded: selectedAsset.isSecured,
      });
      onSendComplete?.();
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Transaction failed";
      // If the unshield landed but the subsequent send failed, the funds
      // are sitting public on the user's wallet now. Tell them rather
      // than leaving silent state.
      const stageAtFailure = sendStage;
      const friendly = getFriendlyError(msg);
      const recovery =
        stageAtFailure === "sending" && selectedAsset?.isSecured && !effectivePrivate
          ? `${friendly} Your ${selectedAsset.symbol} is now unshielded — retry the send to complete it.`
          : friendly;
      setSendError(recovery);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      track(SEND_EVENTS.sendFundsFailed, {
        method: getSendMethod(recipientTrimmed),
        is_private: effectivePrivate,
        from_shielded: selectedAsset?.isSecured,
      });
    } finally {
      setIsSending(false);
      setSendStage("idle");
    }
  }, [
    isFormValid,
    isSending,
    selectedAsset,
    isTelegramRecipient,
    effectivePrivate,
    executeUnshield,
    recipientTrimmed,
    amountInToken,
    onSendComplete,
    sendStage,
    signer,
    signApproval,
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

  const handleSelectAsset = useCallback(
    (key: string) => {
      setSelectedAssetKey(key);
      setShowTokenPicker(false);
      setAmountStr("");
      setCurrencyMode("TOKEN");
      // Picking a shielded balance preserves privacy intent — flip the
      // toggle on. User can still turn it off to do an unshield-then-public
      // send.
      const picked = sendAssets.find((asset) => asset.key === key);
      if (picked?.isSecured) {
        setIsPrivate(true);
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [sendAssets],
  );

  const handlePercentage = useCallback(
    (pct: number) => {
      if (!selectedAsset) return;

      const maxAmount = maxSpendableInToken;
      const raw = pct === 100 ? maxAmount : maxAmount * (pct / 100);
      // Truncate (never round) to avoid floating-point rounding pushing the
      // amount past the balance minus fee reserve, which caused
      // "insufficient funds" when tapping MAX.
      const displayScale = 1e6;
      const truncatedTokens = Math.floor(raw * displayScale) / displayScale;

      if (currencyMode === "TOKEN") {
        setAmountStr(truncatedTokens > 0 ? String(truncatedTokens) : "");
      } else if (tokenPriceUsd) {
        const usd = truncatedTokens * tokenPriceUsd;
        setAmountStr(
          usd > 0 ? (Math.floor(usd * 100) / 100).toFixed(2) : "",
        );
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
    <>
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
                  tokenDetailsByMint={tokenDetailsByMint}
                  onSelect={handleSelectAsset}
                  onCancel={() => setShowTokenPicker(false)}
                />
              ) : (
                <FormStep
                  selectedAsset={selectedAsset}
                  tokenDetailsByMint={tokenDetailsByMint}
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
                  isPrivate={isPrivate}
                  onTogglePrivate={() => {
                    Haptics.selectionAsync();
                    setIsPrivate((current) => !current);
                  }}
                  isTelegramRecipient={isTelegramRecipient}
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
              sendStage={sendStage}
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
    <QrScannerModal
      visible={showQrScanner}
      onClose={() => {
        setShowQrScanner(false);
        setScanError(null);
      }}
      onScan={handleBarcodeScanned}
      scanError={scanError}
      permissionGranted={cameraPermission?.granted === true}
      canAskPermissionAgain={cameraPermission?.canAskAgain !== false}
      onRequestPermission={requestCameraPermission}
    />
    </>
  );
}

// --- Private Send card ---
function PrivateSendCard({
  isPrivate,
  isLocked,
  onToggle,
}: {
  isPrivate: boolean;
  isLocked: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={isLocked ? undefined : onToggle}
      disabled={isLocked}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 16,
        backgroundColor: isPrivate ? "rgba(0, 0, 0, 0.04)" : "transparent",
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: isPrivate ? "rgba(249, 54, 60, 0.14)" : "rgba(0, 0, 0, 0.06)",
        }}
      >
        <ShieldCheck size={22} color={isPrivate ? "#f9363c" : "#666"} strokeWidth={1.8} />
      </View>
      <View style={{ flex: 1 }}>
        <Text className="text-[15px] font-medium text-black">
          {isLocked ? "Private Send Active" : "Private Send"}
        </Text>
        <Text className="mt-0.5 text-[12px] text-neutral-500">
          {isLocked
            ? "Telegram transfers are always private"
            : "Hide your wallet from the recipient"}
        </Text>
      </View>
      {!isLocked ? (
        <View
          style={{
            width: 44,
            height: 26,
            borderRadius: 9999,
            backgroundColor: isPrivate ? "#f9363c" : "rgba(0, 0, 0, 0.08)",
            justifyContent: "center",
            paddingHorizontal: 2,
          }}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: "#fff",
              transform: [{ translateX: isPrivate ? 18 : 0 }],
              shadowColor: "#000",
              shadowOpacity: 0.12,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
            }}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

// --- Form Step ---
function FormStep({
  selectedAsset,
  tokenDetailsByMint,
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
  isPrivate,
  onTogglePrivate,
  isTelegramRecipient,
  onNext,
}: {
  selectedAsset: SendAsset | null;
  tokenDetailsByMint?: TokenDetailsByMint;
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
  isPrivate: boolean;
  onTogglePrivate: () => void;
  isTelegramRecipient: boolean;
  onNext: () => void;
}) {
  const selectedAssetMint = selectedAsset?.mint ?? NATIVE_SOL_MINT;
  const assetIcon = resolveTokenIcon({
    mint: selectedAssetMint,
    imageUrl: selectedAsset?.imageUrl,
    detailLogoUrl: tokenDetailsByMint?.[selectedAssetMint]?.token.logoUrl,
  });

  const [isRecipientFocused, setIsRecipientFocused] = useState(false);
  const shouldTruncateRecipient =
    !isRecipientFocused &&
    recipient.length > 16 &&
    !recipient.startsWith("@");
  const displayedRecipient = shouldTruncateRecipient
    ? `${recipient.slice(0, 6)}…${recipient.slice(-6)}`
    : recipient;

  return (
    <>
      {/* Recipient */}
      <Text className="mb-1.5 text-[14px] font-medium text-neutral-700">To</Text>
      <View
        className="mb-1 flex-row items-center rounded-xl border border-neutral-200 bg-neutral-50"
        style={{ paddingRight: 4 }}
      >
        <BottomSheetTextInput
          style={{
            flex: 1,
            paddingHorizontal: 16,
            paddingVertical: 12,
            fontSize: 16,
            color: "#000",
          }}
          placeholder="Wallet address or @username"
          placeholderTextColor="#999"
          value={displayedRecipient}
          onChangeText={(value) => {
            // While blurred we render a synthetic truncated string. Ignore
            // change events for it so the real address isn't clobbered. Once
            // focused, the displayed value becomes the real value and edits
            // flow through normally.
            if (!isRecipientFocused) return;
            onRecipientChange(value);
          }}
          onFocus={() => setIsRecipientFocused(true)}
          onBlur={() => setIsRecipientFocused(false)}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          className="items-center justify-center rounded-full p-2"
          hitSlop={6}
          onPress={onScanRecipient}
          accessibilityRole="button"
          accessibilityLabel="Scan QR code"
        >
          <ScanLine size={20} color="#666" strokeWidth={1.8} />
        </Pressable>
        <Pressable
          className="items-center justify-center rounded-full p-2"
          hitSlop={6}
          onPress={onPasteRecipient}
          accessibilityRole="button"
          accessibilityLabel="Paste from clipboard"
        >
          <ClipboardPaste size={20} color="#666" strokeWidth={1.8} />
        </Pressable>
      </View>
      {recipientError ? (
        <Text className="mb-3 text-[12px] text-red-500">{recipientError}</Text>
      ) : (
        <View className="mb-3" />
      )}

      {/* Amount */}
      <Text className="mb-1.5 text-[14px] font-medium text-neutral-700">
        Amount
      </Text>
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
        <Pressable
          onPress={onAssetPress}
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
          {selectedAsset ? (
            <View style={{ position: "relative" }}>
              <Image
                source={{ uri: assetIcon }}
                style={{ width: 20, height: 20, borderRadius: 10 }}
              />
              {selectedAsset.isSecured ? (
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
          ) : null}
          <Text className="text-[14px] font-semibold text-black">
            {selectedAsset?.symbol ?? "Select"}
          </Text>
          <ChevronDown size={14} color="#666" />
        </Pressable>
      </View>
      {!isValidAmount && amountStr.length > 0 && (
        <Text className="mt-1 text-[12px] text-red-500">
          {(currencyMode === "TOKEN"
            ? parseFloat(amountStr)
            : tokenPriceUsd
              ? parseFloat(amountStr) / tokenPriceUsd
              : 0) > maxSpendableInToken
            ? "Insufficient balance"
            : "Enter a valid amount"}
        </Text>
      )}

      {/* Balance + MAX + currency toggle */}
      <View className="mb-6 mt-2 flex-row items-center justify-between">
        <Text className="text-[12px] text-neutral-500">
          Balance: {maxSpendableInToken.toFixed(4)} {selectedAsset?.symbol ?? "TOKEN"}
          {tokenPriceUsd
            ? ` (~$${(maxSpendableInToken * tokenPriceUsd).toFixed(2)})`
            : ""}
        </Text>
        <View className="flex-row items-center gap-2">
          {tokenPriceUsd ? (
            <Pressable
              className="rounded-lg px-2 py-1"
              onPress={onToggleCurrency}
              accessibilityRole="button"
              accessibilityLabel="Toggle currency"
            >
              <Text className="text-[12px] font-semibold text-neutral-600">
                {currencyMode === "TOKEN" ? "USD" : selectedAsset?.symbol ?? "TOKEN"}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            className="rounded-lg bg-neutral-200 px-2.5 py-1"
            onPress={() => onPercentage(100)}
          >
            <Text className="text-[12px] font-semibold text-neutral-700">MAX</Text>
          </Pressable>
        </View>
      </View>

      {/* Private Send card */}
      <PrivateSendCard
        isPrivate={isPrivate || isTelegramRecipient}
        isLocked={isTelegramRecipient}
        onToggle={onTogglePrivate}
      />

      {/* Next button */}
      <Pressable
        className={`mt-5 items-center rounded-2xl py-4 ${!isFormValid ? "opacity-40" : ""}`}
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

function QrScannerModal({
  visible,
  onClose,
  onScan,
  scanError,
  permissionGranted,
  canAskPermissionAgain,
  onRequestPermission,
}: {
  visible: boolean;
  onClose: () => void;
  onScan: (event: BarcodeScanningResult) => void;
  scanError: string | null;
  permissionGranted: boolean;
  canAskPermissionAgain: boolean;
  onRequestPermission: () => Promise<{ granted: boolean }>;
}) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const frameSize = Math.min(280, Math.round(screenWidth * 0.72));
  // Center the frame slightly above geometric middle so the instruction text
  // and permission UI have breathing room below.
  const sideStripHeight = Math.max(0, (screenHeight - frameSize) / 2 - 40);

  const handleGrantPermission = useCallback(async () => {
    await onRequestPermission();
  }, [onRequestPermission]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="overFullScreen"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" />
      <View style={qrScannerStyles.root}>
        {permissionGranted ? (
          <CameraView
            style={StyleSheet.absoluteFillObject}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={onScan}
          />
        ) : null}

        {/* Dim overlay with centered transparent frame */}
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <View style={[qrScannerStyles.dim, { height: sideStripHeight }]} />
          <View style={[qrScannerStyles.middleRow, { height: frameSize }]}>
            <View style={[qrScannerStyles.dim, qrScannerStyles.flex1]} />
            <View style={{ width: frameSize, height: frameSize }}>
              <View style={[qrScannerStyles.bracket, qrScannerStyles.bracketTopLeftH]} />
              <View style={[qrScannerStyles.bracket, qrScannerStyles.bracketTopLeftV]} />
              <View style={[qrScannerStyles.bracket, qrScannerStyles.bracketTopRightH]} />
              <View style={[qrScannerStyles.bracket, qrScannerStyles.bracketTopRightV]} />
              <View style={[qrScannerStyles.bracket, qrScannerStyles.bracketBottomLeftH]} />
              <View style={[qrScannerStyles.bracket, qrScannerStyles.bracketBottomLeftV]} />
              <View style={[qrScannerStyles.bracket, qrScannerStyles.bracketBottomRightH]} />
              <View style={[qrScannerStyles.bracket, qrScannerStyles.bracketBottomRightV]} />
            </View>
            <View style={[qrScannerStyles.dim, qrScannerStyles.flex1]} />
          </View>
          <View style={[qrScannerStyles.dim, qrScannerStyles.flex1]} />
        </View>

        {/* Header: title + close */}
        <View
          style={{
            position: "absolute",
            top: insets.top + 12,
            left: 0,
            right: 0,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 16,
          }}
        >
          <Text className="text-[17px] font-semibold text-white" style={{ lineHeight: 22 }}>
            Scan QR
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close scanner"
            hitSlop={12}
            style={{
              position: "absolute",
              right: 16,
              top: -6,
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(0,0,0,0.45)",
            }}
          >
            <X size={20} color="#fff" strokeWidth={2} />
          </Pressable>
        </View>

        {/* Footer: instruction + permission CTA + error */}
        <View
          style={{
            position: "absolute",
            bottom: insets.bottom + 28,
            left: 0,
            right: 0,
            paddingHorizontal: 32,
            alignItems: "center",
          }}
        >
          {permissionGranted ? (
            <Text className="text-center text-[14px] text-white" style={{ opacity: 0.85 }}>
              Align a wallet QR code inside the frame
            </Text>
          ) : canAskPermissionAgain ? (
            <>
              <Text className="mb-3 text-center text-[14px] text-white" style={{ opacity: 0.85 }}>
                Camera access is required to scan QR codes
              </Text>
              <Pressable
                onPress={handleGrantPermission}
                className="rounded-full bg-white px-5 py-2.5"
              >
                <Text className="text-[14px] font-semibold text-black">
                  Grant Camera Access
                </Text>
              </Pressable>
            </>
          ) : (
            <Text className="text-center text-[14px] text-white" style={{ opacity: 0.85 }}>
              Enable camera permission in device settings
            </Text>
          )}
          {scanError ? (
            <Text className="mt-3 text-center text-[13px] text-red-400">
              {scanError}
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const SCANNER_DIM = "rgba(0, 0, 0, 0.65)";
const BRACKET_THICKNESS = 3;
const BRACKET_LENGTH = 26;
const BRACKET_OFFSET = -BRACKET_THICKNESS;

const qrScannerStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  flex1: { flex: 1 },
  dim: { backgroundColor: SCANNER_DIM },
  middleRow: { flexDirection: "row" },
  bracket: { position: "absolute", backgroundColor: "#fff", borderRadius: 1.5 },
  bracketTopLeftH: {
    top: BRACKET_OFFSET,
    left: BRACKET_OFFSET,
    width: BRACKET_LENGTH,
    height: BRACKET_THICKNESS,
  },
  bracketTopLeftV: {
    top: BRACKET_OFFSET,
    left: BRACKET_OFFSET,
    width: BRACKET_THICKNESS,
    height: BRACKET_LENGTH,
  },
  bracketTopRightH: {
    top: BRACKET_OFFSET,
    right: BRACKET_OFFSET,
    width: BRACKET_LENGTH,
    height: BRACKET_THICKNESS,
  },
  bracketTopRightV: {
    top: BRACKET_OFFSET,
    right: BRACKET_OFFSET,
    width: BRACKET_THICKNESS,
    height: BRACKET_LENGTH,
  },
  bracketBottomLeftH: {
    bottom: BRACKET_OFFSET,
    left: BRACKET_OFFSET,
    width: BRACKET_LENGTH,
    height: BRACKET_THICKNESS,
  },
  bracketBottomLeftV: {
    bottom: BRACKET_OFFSET,
    left: BRACKET_OFFSET,
    width: BRACKET_THICKNESS,
    height: BRACKET_LENGTH,
  },
  bracketBottomRightH: {
    bottom: BRACKET_OFFSET,
    right: BRACKET_OFFSET,
    width: BRACKET_LENGTH,
    height: BRACKET_THICKNESS,
  },
  bracketBottomRightV: {
    bottom: BRACKET_OFFSET,
    right: BRACKET_OFFSET,
    width: BRACKET_THICKNESS,
    height: BRACKET_LENGTH,
  },
});

function TokenPicker({
  assets,
  tokenDetailsByMint,
  onSelect,
  onCancel,
}: {
  assets: SendAsset[];
  tokenDetailsByMint?: TokenDetailsByMint;
  onSelect: (key: string) => void;
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
        const icon = resolveTokenIcon({
          mint: asset.mint,
          imageUrl: asset.imageUrl,
          detailLogoUrl: tokenDetailsByMint?.[asset.mint]?.token.logoUrl,
        });
        return (
          <Pressable
            key={asset.key}
            className="flex-row items-center rounded-xl px-2 py-3 active:bg-neutral-100"
            onPress={() => onSelect(asset.key)}
          >
            <View style={{ position: "relative" }}>
              <Image
                source={{ uri: icon }}
                style={{ width: 32, height: 32, borderRadius: 16 }}
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
            <View className="ml-3 flex-1">
              <Text className="text-[14px] font-medium text-black">
                {asset.symbol}
                {asset.isSecured ? " · Shielded" : ""}
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
  sendStage,
  txSignature,
  amountInToken,
  tokenSymbol,
  recipient,
  onDone,
}: {
  isSending: boolean;
  sendError: string | null;
  sendStage: "idle" | "unshielding" | "sending";
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
    const primaryLabel =
      sendStage === "unshielding"
        ? "Unshielding funds…"
        : "Sending transaction…";
    return (
      <View className="items-center py-12">
        <ActivityIndicator size="large" color="#000" />
        <Text className="mt-4 text-[16px] text-neutral-600">
          {primaryLabel}
        </Text>
        {sendStage === "unshielding" ? (
          <Text className="mt-2 text-[12px] text-neutral-400">
            Preparing public balance for this send…
          </Text>
        ) : null}
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
