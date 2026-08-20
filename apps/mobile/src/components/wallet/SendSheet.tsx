import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  BottomSheetView,
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
  Check,
  ChevronDown,
  ScanLine,
  Search,
  Wallet,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Keyboard,
  Linking,
  Modal,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
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
import { useFixedSheetLayout } from "@/hooks/useFixedSheetLayout";
import { useKeyboardRescueFocus } from "@/hooks/useKeyboardRescueFocus";

import { useShield } from "@/hooks/wallet/useShield";
import { useWalletTransactions } from "@/hooks/wallet/useWalletTransactions";
import { track } from "@/lib/analytics/analytics";
import { getSendMethod, SEND_EVENTS } from "@/lib/analytics/send-events";
import {
  MAX_RECENT_RECIPIENTS,
  NATIVE_SOL_MINT,
  SOLANA_FEE_SOL,
} from "@/lib/solana/constants";
import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import type { TokenDetailsByMint } from "@/hooks/wallet/useTokenDetails";
import { resolveTokenIcon } from "@/lib/solana/token-holdings/resolve-token-info";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { formatSenderAddress } from "@/lib/solana/wallet/formatters";
import {
  sendPrivateTransferToTelegramUsername,
  sendPrivateTransferToWallet,
} from "@/lib/solana/wallet/private-send";
import { sendSolTransaction, sendSplTokenTransaction } from "@/lib/solana/wallet/wallet-details";
import { useWallet } from "@/lib/wallet/wallet-provider";
import { Pressable, Text, View } from "@/tw";
import type { Transaction } from "@/types/wallet";

import SwapCurrencyIcon from "../../../assets/images/icons/swap_currency_28.svg";
import XCloseIcon from "../../../assets/images/icons/x_close_24.svg";
import SendErrorDog from "../../../assets/images/wallet/send_error_dog.svg";
import SendSpinnerIcon from "../../../assets/images/wallet/send_spinner_80.svg";
import SendSuccessDog from "../../../assets/images/wallet/send_success_dog.svg";

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

// Truncate addresses as 2fKB...Nhtj (matches the activity feed's formatting).
function formatRecipientLabel(value: string): string {
  return formatSenderAddress(value.trim());
}

// Shown under the recipient input when the value isn't a valid Solana address.
const INVALID_RECIPIENT_HINT = "Invalid Solana address";

// Thousands-separated number formatting without relying on Intl (Hermes
// support is uneven). Trims trailing zeros down to `minFrac`.
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

// SOL amounts need more precision than tokens — the network fee is 0.000005
// SOL, so the review "Total amount" must keep up to 6 decimals to surface it.
function formatSolAmount(value: number): string {
  return formatWithCommas(value, 0, 6);
}

// Fee in USD for the review card. Mirrors the design's "<$0.01" treatment for
// sub-cent fees; otherwise an approximate dollar value.
function formatFeeUsd(feeUsd: number | null): string {
  if (feeUsd === null) return "";
  if (feeUsd < 0.01) return "<$0.01";
  return `≈ ${formatUsdAmount(feeUsd)}`;
}

// Sheet is pinned to a definite height so the absolute keyboard-riding
// footer's `bottom: 0` lands at the sheet bottom rather than the content
// bottom. Height + snap point both come from useFixedSheetLayout so they can
// never diverge (screen-height math overshot the sheet on iPad/notched
// iPhones and clipped the CTA).
const SCREEN_WIDTH = Dimensions.get("screen").width;

// Amount auto-shrink (ported from DepositSheet): keep the big amount on one
// line by scaling the font down; lineHeight stays pinned so the baseline holds.
const AMOUNT_MAX_FONT_SIZE = 48;
const AMOUNT_MIN_FONT_SIZE = 22;
const AMOUNT_CHAR_WIDTH_RATIO = 0.6;

// Strip an amount field to clean numeric text (no commas, single dot). Unlike
// DepositSheet we don't cap decimals — token amounts need more precision.
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

// Thousands-separated display for the amount field, preserving a trailing dot
// while the user is mid-typing.
function formatAmountInputDisplay(raw: string): string {
  if (!raw) return "";
  const trailingDot = raw.endsWith(".") && !raw.slice(0, -1).includes(".");
  const [intPart, decPart] = raw.split(".");
  const intText = formatWithCommas(Number(intPart || "0"), 0, 0);
  if (trailingDot) return `${intText}.`;
  return decPart !== undefined ? `${intText}.${decPart}` : intText;
}

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

type SendStep = "recipient" | "form" | "confirm" | "result";

type RecentRecipient = {
  /** Full Solana address or @telegram username. */
  address: string;
  /** Number of past outgoing sends to this recipient. */
  sendCount: number;
};

// Build the "Recently used" list from wallet activity: dedupe outgoing
// transfers by recipient, count sends, and sort most-recent first.
function deriveRecentRecipients(transactions: Transaction[]): RecentRecipient[] {
  const byRecipient = new Map<
    string,
    { address: string; sendCount: number; lastTimestamp: number }
  >();

  for (const tx of transactions) {
    if (tx.type !== "outgoing") continue;
    const address = tx.recipient?.trim();
    if (!address) continue;
    const key = address.toLowerCase();
    const existing = byRecipient.get(key);
    byRecipient.set(key, {
      address: existing?.address ?? address,
      sendCount: (existing?.sendCount ?? 0) + 1,
      lastTimestamp: Math.max(existing?.lastTimestamp ?? 0, tx.timestamp ?? 0),
    });
  }

  return Array.from(byRecipient.values())
    .sort((a, b) => b.lastTimestamp - a.lastTimestamp)
    .slice(0, MAX_RECENT_RECIPIENTS)
    .map(({ address, sendCount }) => ({ address, sendCount }));
}

type SendSheetProps = {
  open: boolean;
  onClose: () => void;
  solBalanceLamports: number | null;
  solPriceUsd: number | null;
  tokenHoldings: TokenHolding[];
  tokenDetailsByMint?: TokenDetailsByMint;
  onSendComplete?: () => void;
  initialMint?: string;
  /** Open straight into the QR scanner (used by the header scan button). */
  initialShowScanner?: boolean;
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
  initialShowScanner,
}: SendSheetProps) {
  const { signer, publicKey } = useWallet();
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const { sheetHeight, snapPoints } = useFixedSheetLayout();
  const recipientInputRef = useRef<{ focus: () => void } | null>(null);
  const amountInputRef = useRef<{ focus: () => void } | null>(null);
  const sheetSettledRef = useRef(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scanLockRef = useRef(false);
  const scanUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [step, setStep] = useState<SendStep>("recipient");
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
  // Acknowledgment of the "self-custodial wallets only" warning shown before a
  // private transfer to a wallet address. Reset on each entry to the confirm
  // step so the user re-acknowledges per transfer.
  const [privacyAck, setPrivacyAck] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [sendStage, setSendStage] = useState<
    "idle" | "unshielding" | "sending"
  >("idle");

  const { executeUnshield } = useShield();

  // Recent recipients are derived from wallet activity. Gate the fetch on
  // `open` (pass null while closed) so screens that don't otherwise load
  // activity don't trigger a background history fetch until Send is opened.
  const { walletTransactions } = useWalletTransactions(open ? publicKey : null);
  const recentRecipients = useMemo(
    () => deriveRecentRecipients(walletTransactions),
    [walletTransactions],
  );

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
  const recipientSummaryLabel = formatRecipientLabel(recipientTrimmed);
  // Telegram recipients are always private. Wallet recipients honor the
  // user toggle. Selecting a shielded source from the picker doesn't
  // imply private — that just controls which balance gets debited.
  const effectivePrivate = isTelegramRecipient || isPrivate;
  // A private transfer to a typed wallet address requires the recipient to
  // control the keys and claim it, so warn before sending — funds sent to an
  // exchange deposit address or a smart contract may be lost. Telegram
  // recipients claim in-app, so the warning doesn't apply to them.
  const showPrivacyWarning = effectivePrivate && isWalletRecipient;
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
      setStep("recipient");
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
      if (initialShowScanner) {
        void handleOpenQrScanner();
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
      // The dedicated review step already confirms the transfer, so sign
      // directly — no extra decoded-transaction approval modal. (Seed Vault
      // wallets still get their own native biometric prompt.)
      let sig: string;
      if (effectivePrivate) {
        sig = isTelegramRecipient
          ? await sendPrivateTransferToTelegramUsername({
              username: recipientTrimmed,
              tokenMint: selectedAsset.mint,
              amount: amountInToken,
              decimals: selectedAsset.decimals,
              signer,
            })
          : await sendPrivateTransferToWallet({
              destination: recipientTrimmed,
              tokenMint: selectedAsset.mint,
              amount: amountInToken,
              decimals: selectedAsset.decimals,
              signer,
            });
      } else if (selectedAsset.mint === NATIVE_SOL_MINT) {
        sig = await sendSolTransaction(
          recipientTrimmed,
          Math.floor(amountInToken * LAMPORTS_PER_SOL),
          signer,
        );
      } else {
        sig = await sendSplTokenTransaction(
          recipientTrimmed,
          selectedAsset.mint,
          toRawAmount(amountInToken, selectedAsset.decimals),
          selectedAsset.decimals,
          signer,
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

  const focusActiveInput = useCallback(() => {
    if (step === "recipient") {
      recipientInputRef.current?.focus();
    } else if (step === "form" && !showTokenPicker) {
      amountInputRef.current?.focus();
    }
  }, [step, showTokenPicker]);

  const handleSheetChange = useCallback(
    (index: number) => {
      sheetSettledRef.current = index >= 0;
      // Focus once the sheet is at its snap point — focusing during the
      // present animation pushes the keyboard above the sheet.
      if (index >= 0) {
        setTimeout(focusActiveInput, 120);
      }
    },
    [focusActiveInput],
  );

  // Re-focus the right input on step / picker transitions (the sheet is
  // already settled, so `onChange` won't fire again).
  useEffect(() => {
    if (!sheetSettledRef.current) return;
    const id = setTimeout(focusActiveInput, 80);
    return () => clearTimeout(id);
  }, [focusActiveInput]);

  return (
    <>
    <BottomSheetModal
      ref={bottomSheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose={step !== "result" || !isSending}
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
        {step === "recipient" && (
          <RecipientStep
            recipient={recipient}
            onRecipientChange={setRecipient}
            onPasteRecipient={handlePasteRecipient}
            onScanRecipient={handleOpenQrScanner}
            onClose={handleClose}
            onPickRecipient={setRecipient}
            onProceed={() => setStep("form")}
            recentRecipients={recentRecipients}
            inputRef={recipientInputRef}
          />
        )}

        {step === "form" && !showTokenPicker && (
          <AmountStep
            recipientLabel={recipientSummaryLabel}
            onBack={() => setStep("recipient")}
            selectedAsset={selectedAsset}
            tokenDetailsByMint={tokenDetailsByMint}
            onAssetPress={() => {
              Keyboard.dismiss();
              setShowTokenPicker(true);
            }}
            amountStr={amountStr}
            onAmountChange={setAmountStr}
            currencyMode={currencyMode}
            onToggleCurrency={toggleCurrency}
            onMax={() => handlePercentage(100)}
            amountInToken={amountInToken}
            amountInUsd={amountInUsd}
            maxSpendableInToken={maxSpendableInToken}
            tokenPriceUsd={tokenPriceUsd}
            isValidAmount={amountStr.length > 0 ? isValidAmount : true}
            isFormValid={isFormValid}
            onNext={() => {
              Keyboard.dismiss();
              setPrivacyAck(false);
              setStep("confirm");
            }}
            inputRef={amountInputRef}
          />
        )}

        {step === "form" && showTokenPicker && (
          <BottomSheetScrollView
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            <AssetPickerStep
              assets={sendAssets}
              tokenDetailsByMint={tokenDetailsByMint}
              onSelect={handleSelectAsset}
              onBack={() => setShowTokenPicker(false)}
            />
          </BottomSheetScrollView>
        )}

        {step === "confirm" && (
          <ConfirmStep
            recipientLabel={recipientSummaryLabel}
            selectedAsset={selectedAsset}
            tokenDetailsByMint={tokenDetailsByMint}
            amountInToken={amountInToken}
            amountInUsd={amountInUsd}
            feeSol={sendFeeReserveSol}
            solPriceUsd={solPriceUsd}
            isSending={isSending}
            showPrivacyWarning={showPrivacyWarning}
            privacyAck={privacyAck}
            onTogglePrivacyAck={() => setPrivacyAck((value) => !value)}
            onBack={() => setStep("form")}
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
            recipientLabel={recipientSummaryLabel}
            onClose={handleClose}
          />
        )}
      </BottomSheetView>
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

// --- Recipient step (first step of the send flow) ---
function RecipientGroupHeader({ title }: { title: string }) {
  return (
    <View style={{ paddingHorizontal: 16 }}>
      <View style={{ paddingTop: 12, paddingBottom: 8 }}>
        <Text
          className="text-[17px] font-medium"
          style={{
            color: "rgba(60,60,67,0.6)",
            letterSpacing: -0.187,
            lineHeight: 22,
          }}
        >
          {title}
        </Text>
      </View>
    </View>
  );
}

function RecipientCell({
  label,
  subtitle,
  onPress,
}: {
  label: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      className="w-full flex-row items-center"
      style={{ paddingHorizontal: 16 }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Send to ${label}`}
    >
      <View style={{ paddingRight: 12, paddingVertical: 6 }}>
        <View
          className="items-center justify-center rounded-xl"
          style={{ width: 48, height: 48, backgroundColor: "rgba(0,0,0,0.04)" }}
        >
          <Wallet size={28} color="rgba(60,60,67,0.4)" strokeWidth={1.6} />
        </View>
      </View>
      <View className="flex-1" style={{ paddingVertical: 9 }}>
        <Text
          className="text-[17px] font-medium text-black"
          style={{ lineHeight: 22 }}
          numberOfLines={1}
        >
          {label}
        </Text>
        <Text
          className="text-[15px] font-normal"
          style={{ color: "rgba(60,60,67,0.6)", lineHeight: 20 }}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

function formatSendCount(count: number): string {
  return `${count} ${count === 1 ? "send" : "sends"}`;
}

function RecipientStep({
  recipient,
  onRecipientChange,
  onPasteRecipient,
  onScanRecipient,
  onClose,
  onPickRecipient,
  onProceed,
  recentRecipients,
  inputRef,
}: {
  recipient: string;
  onRecipientChange: (value: string) => void;
  onPasteRecipient: () => void;
  onScanRecipient: () => void;
  onClose: () => void;
  onPickRecipient: (address: string) => void;
  onProceed: () => void;
  recentRecipients: RecentRecipient[];
  inputRef: React.MutableRefObject<{
    focus: () => void;
    blur?: () => void;
  } | null>;
}) {
  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard();
  const footerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboard.height.value }],
  }));

  const trimmed = recipient.trim();
  const hasInput = trimmed.length > 0;
  const isValid = isValidSolanaAddress(trimmed);
  const showError = hasInput && !isValid;
  const matchedRecent = recentRecipients.find(
    (entry) => entry.address.toLowerCase() === trimmed.toLowerCase(),
  );

  return (
    <View className="w-full" style={{ flex: 1 }}>
      {/* Toolbar */}
      <View className="w-full" style={{ paddingVertical: 16 }}>
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
              Recipient
            </Text>
          </View>
          <Pressable
            className="h-11 w-11 items-center justify-center rounded-full bg-[#f2f2f7]"
            hitSlop={6}
            onPress={onScanRecipient}
            accessibilityRole="button"
            accessibilityLabel="Scan QR code"
          >
            <ScanLine size={24} color="rgba(60,60,67,0.6)" strokeWidth={1.8} />
          </Pressable>
        </View>
      </View>

      {/* Recipient input */}
      <View style={{ paddingTop: 36, paddingHorizontal: 16, paddingBottom: 16 }}>
        <View className="flex-row items-start" style={{ minHeight: 48 }}>
          <BottomSheetTextInput
            ref={inputRef as unknown as React.Ref<never>}
            style={{
              flex: 1,
              minHeight: 48,
              paddingVertical: 12,
              fontFamily: "Geist_500Medium",
              fontSize: 20,
              lineHeight: 24,
              color: "#000",
            }}
            placeholder="Solana address"
            placeholderTextColor="rgba(60,60,67,0.4)"
            value={recipient}
            onChangeText={onRecipientChange}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            multiline
            scrollEnabled={false}
          />
          {hasInput ? (
            <Pressable
              className="items-center justify-center"
              style={{ paddingLeft: 12, paddingVertical: 12 }}
              hitSlop={6}
              onPress={() => onRecipientChange("")}
              accessibilityRole="button"
              accessibilityLabel="Clear recipient"
            >
              <XCloseIcon width={24} height={24} />
            </Pressable>
          ) : (
            <View
              className="justify-center"
              style={{ paddingLeft: 12, height: 48 }}
            >
              <Pressable
                className="items-center justify-center rounded-full"
                style={{
                  minWidth: 64,
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  backgroundColor: "rgba(0,0,0,0.04)",
                }}
                onPress={onPasteRecipient}
                accessibilityRole="button"
                accessibilityLabel="Paste from clipboard"
              >
                <Text
                  className="text-[15px] font-medium text-black"
                  style={{ lineHeight: 20 }}
                >
                  Paste
                </Text>
              </Pressable>
            </View>
          )}
        </View>
        {showError ? (
          <Text
            className="text-[15px] font-normal"
            style={{ color: "#f9363c", lineHeight: 20, marginTop: 4 }}
          >
            {INVALID_RECIPIENT_HINT}
          </Text>
        ) : null}
      </View>

      {/* Results: exact match for a valid address, otherwise recently used
          (shown for both the empty and invalid states). */}
      <BottomSheetScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 96 }}
        keyboardShouldPersistTaps="handled"
      >
        {isValid ? (
          <View className="w-full">
            <RecipientGroupHeader title="Exact match" />
            <RecipientCell
              label={formatRecipientLabel(trimmed)}
              subtitle={
                matchedRecent
                  ? formatSendCount(matchedRecent.sendCount)
                  : "New address"
              }
              onPress={() => onPickRecipient(trimmed)}
            />
          </View>
        ) : recentRecipients.length > 0 ? (
          <View className="w-full">
            <RecipientGroupHeader title="Recently used" />
            {recentRecipients.map((entry) => (
              <RecipientCell
                key={entry.address}
                label={formatRecipientLabel(entry.address)}
                subtitle={formatSendCount(entry.sendCount)}
                onPress={() => onPickRecipient(entry.address)}
              />
            ))}
          </View>
        ) : null}
      </BottomSheetScrollView>

      {/* Proceed CTA — rides up with the keyboard. */}
      <Animated.View
        style={[
          {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "#fff",
            paddingHorizontal: 20,
            paddingTop: 16,
            paddingBottom: insets.bottom + 12,
          },
          footerStyle,
        ]}
      >
        <Pressable
          onPress={() => {
            if (isValid) onProceed();
          }}
          disabled={!isValid}
          accessibilityRole="button"
          accessibilityLabel="Proceed"
          style={{
            height: 50,
            borderRadius: 78,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#000",
            opacity: isValid ? 1 : 0.4,
          }}
        >
          <Text
            className="text-[16px] font-medium text-white"
            style={{ lineHeight: 20 }}
          >
            Proceed
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// --- Amount step (second step of the send flow) ---
function AmountStep({
  recipientLabel,
  onBack,
  selectedAsset,
  tokenDetailsByMint,
  onAssetPress,
  amountStr,
  onAmountChange,
  currencyMode,
  onToggleCurrency,
  onMax,
  amountInToken,
  amountInUsd,
  maxSpendableInToken,
  tokenPriceUsd,
  isValidAmount,
  isFormValid,
  onNext,
  inputRef,
}: {
  recipientLabel: string;
  onBack: () => void;
  selectedAsset: SendAsset | null;
  tokenDetailsByMint?: TokenDetailsByMint;
  onAssetPress: () => void;
  amountStr: string;
  onAmountChange: (v: string) => void;
  currencyMode: "TOKEN" | "USD";
  onToggleCurrency: () => void;
  onMax: () => void;
  amountInToken: number;
  amountInUsd: number;
  maxSpendableInToken: number;
  tokenPriceUsd: number | null;
  isValidAmount: boolean;
  isFormValid: boolean;
  onNext: () => void;
  inputRef: React.MutableRefObject<{
    focus: () => void;
    blur?: () => void;
  } | null>;
}) {
  const { openKeyboard } = useKeyboardRescueFocus(inputRef);
  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard();
  const footerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboard.height.value }],
  }));

  // Custom blinking caret — the real input's caret is hidden (it's a
  // transparent overlay). Mirrors DepositSheet.
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

  const symbol = selectedAsset?.symbol ?? "TOKEN";
  const selectedAssetMint = selectedAsset?.mint ?? NATIVE_SOL_MINT;
  const assetIcon = resolveTokenIcon({
    mint: selectedAssetMint,
    imageUrl: selectedAsset?.imageUrl,
    detailLogoUrl: tokenDetailsByMint?.[selectedAssetMint]?.token.logoUrl,
  });
  const balance = selectedAsset?.balance ?? 0;

  const displayAmount = formatAmountInputDisplay(amountStr);
  const showAmountError = amountStr.length > 0 && !isValidAmount;
  const amountErrorText =
    amountInToken > maxSpendableInToken
      ? "Insufficient balance"
      : "Enter a valid amount";
  const conversionText =
    currencyMode === "USD"
      ? `${formatTokenAmount(amountInToken, 0)} ${symbol}`
      : formatUsdAmount(amountInUsd);

  // Scale the amount text down so it stays on one line; lineHeight stays pinned
  // at the max size so the baseline doesn't move.
  const amountFontSize = useMemo(() => {
    const text = `${currencyMode === "USD" ? "$" : ""}${displayAmount || "0"}`;
    const availableWidth = SCREEN_WIDTH - 32 - 52; // px-16*2 + swap button
    const fitted = Math.floor(
      availableWidth / (text.length * AMOUNT_CHAR_WIDTH_RATIO),
    );
    return Math.max(AMOUNT_MIN_FONT_SIZE, Math.min(AMOUNT_MAX_FONT_SIZE, fitted));
  }, [currencyMode, displayAmount]);

  const amountTextStyle = {
    fontFamily: "Geist_600SemiBold",
    fontSize: amountFontSize,
    // 58pt line box: iOS clips Geist's ascenders at lineHeight == fontSize.
    lineHeight: 58,
    color: "#000",
    includeFontPadding: false,
  } as const;

  return (
    <View className="w-full" style={{ flex: 1 }}>
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
              Send
            </Text>
            <Text
              className="text-[15px] font-normal"
              style={{ color: "rgba(60,60,67,0.6)", lineHeight: 20, marginTop: 2 }}
            >
              to {recipientLabel}
            </Text>
          </View>
          <View className="h-11 w-11" style={{ opacity: 0 }} />
        </View>
      </View>

      {/* Amount input — transparent overlay BottomSheetTextInput captures
          taps/keyboard; the visible "$"+digits + custom caret render on top
          (pointerEvents="none"). */}
      <View style={{ paddingTop: 36, paddingHorizontal: 16 }}>
        <Pressable
          style={{ position: "relative", height: 58, justifyContent: "flex-end" }}
          onPress={openKeyboard}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              paddingRight: 52,
              pointerEvents: "none",
            }}
          >
            {currencyMode === "USD" ? (
              <Text style={amountTextStyle}>$</Text>
            ) : null}
            <Text style={amountTextStyle}>{displayAmount || "0"}</Text>
            <View
              style={{
                width: 2,
                height: 40,
                marginHorizontal: 2,
                // Centered like the glyphs — both platforms center text in
                // the 58pt line box; bottom-pinned sat below the digits.
                alignSelf: "center",
                borderRadius: 1,
                backgroundColor: "#000",
                opacity: isFocused && caretOn ? 1 : 0,
              }}
            />
          </View>
          <BottomSheetTextInput
            ref={inputRef as unknown as React.Ref<never>}
            value={displayAmount}
            onChangeText={(t) => onAmountChange(stripAmountInput(t))}
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
            accessibilityLabel="Send amount"
          />
          {tokenPriceUsd ? (
            <Pressable
              onPress={onToggleCurrency}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Switch between token and USD"
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <SwapCurrencyIcon width={28} height={28} />
            </Pressable>
          ) : null}
        </Pressable>
        <Text
          className="text-[15px] font-normal"
          style={{
            color: showAmountError ? "#f9363c" : "rgba(60,60,67,0.6)",
            lineHeight: 20,
            marginTop: 4,
          }}
        >
          {showAmountError ? amountErrorText : conversionText}
        </Text>
      </View>

      {/* Footer: token selector + balance + MAX, then the Review CTA. Pinned to
          the sheet bottom and rides up with the keyboard. */}
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
          },
          footerStyle,
        ]}
      >
        <View
          className="w-full flex-row items-center"
          style={{ paddingHorizontal: 16, marginBottom: 16 }}
        >
          <Pressable
            style={{ paddingRight: 12, paddingVertical: 2 }}
            onPress={onAssetPress}
            accessibilityRole="button"
            accessibilityLabel="Select token"
          >
            <View
              className="flex-row items-center"
              style={{
                backgroundColor: "rgba(0,0,0,0.04)",
                borderRadius: 61,
                padding: 4,
              }}
            >
              <View style={{ position: "relative" }}>
                <Image
                  source={{ uri: assetIcon }}
                  style={{ width: 40, height: 40, borderRadius: 20 }}
                />
                {selectedAsset?.isSecured ? (
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
              <View
                style={{
                  width: 24,
                  height: 16,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ChevronDown size={18} color="rgba(60,60,67,0.4)" />
              </View>
            </View>
          </Pressable>
          <View className="flex-1" style={{ paddingVertical: 8 }}>
            <Text
              className="text-[20px] font-semibold text-black"
              style={{ lineHeight: 24 }}
              numberOfLines={1}
            >
              {formatUsdAmount(balance * (tokenPriceUsd ?? 0))}
            </Text>
            <Text
              className="text-[15px] font-normal"
              style={{ color: "rgba(60,60,67,0.6)", lineHeight: 20 }}
              numberOfLines={1}
            >
              {formatTokenAmount(balance)} {symbol}
            </Text>
          </View>
          <View style={{ paddingLeft: 12 }}>
            <Pressable
              className="items-center justify-center"
              style={{
                minWidth: 64,
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 40,
                backgroundColor: "rgba(0,0,0,0.04)",
              }}
              onPress={onMax}
              accessibilityRole="button"
              accessibilityLabel="Use max balance"
            >
              <Text
                className="text-[15px] font-medium text-black"
                style={{ lineHeight: 20 }}
              >
                MAX
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={{ paddingHorizontal: 20 }}>
          <Pressable
            className="items-center justify-center"
            style={{
              height: 50,
              borderRadius: 78,
              backgroundColor: "#000",
              opacity: isFormValid ? 1 : 0.4,
            }}
            onPress={onNext}
            disabled={!isFormValid}
            accessibilityRole="button"
            accessibilityLabel="Review send"
          >
            <Text
              className="text-[16px] font-medium text-white"
              style={{ lineHeight: 20 }}
            >
              Review
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

// --- Asset selection sheet ---
function AssetPickerStep({
  assets,
  tokenDetailsByMint,
  onSelect,
  onBack,
}: {
  assets: SendAsset[];
  tokenDetailsByMint?: TokenDetailsByMint;
  onSelect: (key: string) => void;
  onBack: () => void;
}) {
  const [search, setSearch] = useState("");

  const filteredAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return assets;
    return assets.filter(
      (asset) =>
        asset.symbol.toLowerCase().includes(query) ||
        asset.name.toLowerCase().includes(query) ||
        asset.mint.toLowerCase().includes(query),
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
      {filteredAssets.map((asset) => {
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

      {filteredAssets.length === 0 ? (
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

// --- Confirm / review step ---
function ConfirmRow({
  label,
  value,
  valueWeight = "normal",
  secondary,
}: {
  label: string;
  value: string;
  valueWeight?: "normal" | "medium";
  secondary?: string;
}) {
  return (
    <View
      className="w-full flex-row items-center"
      style={{ paddingHorizontal: 16, overflow: "hidden" }}
    >
      <View className="flex-1" style={{ paddingVertical: 10 }}>
        <Text
          className="text-[14px] font-normal"
          style={{ color: "rgba(60,60,67,0.6)", lineHeight: 18 }}
        >
          {label}
        </Text>
        <View
          className="w-full flex-row items-center"
          style={{ gap: 4 }}
        >
          <Text
            className={`text-[17px] text-black ${
              valueWeight === "medium" ? "font-medium" : "font-normal"
            }`}
            style={{ lineHeight: 22, letterSpacing: -0.187 }}
            numberOfLines={1}
          >
            {value}
          </Text>
          {secondary ? (
            <Text
              className="text-[17px] font-normal"
              style={{
                color: "rgba(60,60,67,0.6)",
                lineHeight: 22,
                letterSpacing: -0.187,
              }}
              numberOfLines={1}
            >
              {secondary}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function ConfirmStep({
  recipientLabel,
  selectedAsset,
  tokenDetailsByMint,
  amountInToken,
  amountInUsd,
  feeSol,
  solPriceUsd,
  isSending,
  showPrivacyWarning,
  privacyAck,
  onTogglePrivacyAck,
  onBack,
  onConfirm,
}: {
  recipientLabel: string;
  selectedAsset: SendAsset | null;
  tokenDetailsByMint?: TokenDetailsByMint;
  amountInToken: number;
  amountInUsd: number;
  feeSol: number;
  solPriceUsd: number | null;
  isSending: boolean;
  showPrivacyWarning: boolean;
  privacyAck: boolean;
  onTogglePrivacyAck: () => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const insets = useSafeAreaInsets();

  const symbol = selectedAsset?.symbol ?? "TOKEN";
  const assetMint = selectedAsset?.mint ?? NATIVE_SOL_MINT;
  const isNativeSol = assetMint === NATIVE_SOL_MINT;
  const assetIcon = resolveTokenIcon({
    mint: assetMint,
    imageUrl: selectedAsset?.imageUrl,
    detailLogoUrl: tokenDetailsByMint?.[assetMint]?.token.logoUrl,
  });

  const formatAssetAmount = (value: number) =>
    isNativeSol ? formatSolAmount(value) : formatTokenAmount(value, 0);

  const feeUsd = solPriceUsd !== null ? feeSol * solPriceUsd : null;
  // The fee is paid in SOL. For a native-SOL send it folds into the token
  // total; for an SPL send the token amount stands alone (the fee is broken
  // out in its own row) and the all-in cost is carried by the USD figure.
  const totalToken = isNativeSol ? amountInToken + feeSol : amountInToken;
  const totalUsd = isNativeSol
    ? totalToken * (solPriceUsd ?? 0)
    : amountInUsd;

  // For a private transfer to a wallet address the user must tick the warning
  // before sending; otherwise only the in-flight guard applies.
  const confirmDisabled = isSending || (showPrivacyWarning && !privacyAck);

  return (
    <View className="w-full" style={{ flex: 1 }}>
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
              Send
            </Text>
            <Text
              className="text-[15px] font-normal"
              style={{ color: "rgba(60,60,67,0.6)", lineHeight: 20, marginTop: 2 }}
            >
              to {recipientLabel}
            </Text>
          </View>
          <View className="h-11 w-11" style={{ opacity: 0 }} />
        </View>
      </View>

      {/* Asset icon */}
      <View
        className="w-full flex-row items-start"
        style={{ padding: 16 }}
      >
        <View style={{ position: "relative" }}>
          <Image
            source={{ uri: assetIcon }}
            style={{ width: 64, height: 64, borderRadius: 32 }}
          />
          {selectedAsset?.isSecured ? (
            <Image
              source={shieldBadge}
              style={{
                position: "absolute",
                bottom: -2,
                right: -2,
                width: 20,
                height: 20,
              }}
            />
          ) : null}
        </View>
      </View>

      {/* Amount being sent */}
      <View style={{ paddingTop: 16, paddingHorizontal: 16 }}>
        <View style={{ paddingBottom: 20, paddingHorizontal: 8 }}>
          <View className="flex-row items-baseline" style={{ gap: 8 }}>
            <Text
              style={{
                fontFamily: "Geist_600SemiBold",
                fontSize: 40,
                lineHeight: 48,
                color: "#000",
              }}
            >
              −{formatAssetAmount(amountInToken)}
            </Text>
            <Text
              style={{
                fontFamily: "Geist_600SemiBold",
                fontSize: 28,
                lineHeight: 32,
                letterSpacing: 0.4,
                color: "rgba(60,60,67,0.4)",
              }}
            >
              {symbol}
            </Text>
          </View>
          {amountInUsd > 0 ? (
            <Text
              className="text-[17px] font-normal"
              style={{
                color: "rgba(60,60,67,0.6)",
                lineHeight: 22,
                marginTop: 4,
              }}
            >
              ≈{formatUsdAmount(amountInUsd)}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Details card */}
      <BottomSheetScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          className="w-full"
          style={{ backgroundColor: "#f2f2f7", borderRadius: 20, paddingVertical: 4 }}
        >
          <ConfirmRow label="Recipient" value={recipientLabel} />
          <ConfirmRow
            label="Transfer fee"
            value={`${formatSolAmount(feeSol)} SOL`}
            secondary={formatFeeUsd(feeUsd)}
          />
          <ConfirmRow
            label="Total amount"
            value={`${formatAssetAmount(totalToken)} ${symbol}`}
            valueWeight="medium"
            secondary={totalUsd > 0 ? `≈ ${formatUsdAmount(totalUsd)}` : undefined}
          />
        </View>

        {showPrivacyWarning ? (
          <View
            className="rounded-2xl p-4"
            style={{ backgroundColor: "rgba(249, 54, 60, 0.1)", marginTop: 16 }}
          >
            <View className="mb-2 flex-row items-center gap-2">
              <AlertCircle size={18} color="#f9363c" strokeWidth={2} />
              <Text className="text-[14px] font-semibold text-black">
                Private transfer — self-custodial wallets only
              </Text>
            </View>
            <Text className="text-[13px] leading-5 text-neutral-700">
              • Only works to a self-custodial wallet you control (Phantom,
              Solflare, etc.)
            </Text>
            <Text className="mt-1 text-[13px] leading-5 text-neutral-700">
              • Do <Text className="font-semibold text-black">NOT</Text> send to a
              centralized exchange
            </Text>
            <Text className="mt-1 text-[13px] leading-5 text-neutral-700">
              • Do <Text className="font-semibold text-black">NOT</Text> send to a
              smart contract
            </Text>
            <Text className="mt-2 text-[12px] leading-4 text-neutral-500">
              The recipient must be able to claim the transfer. Funds sent to an
              exchange or a contract may be lost.
            </Text>

            <Pressable
              onPress={onTogglePrivacyAck}
              className="mt-3 flex-row items-center gap-2"
              hitSlop={8}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: privacyAck }}
            >
              <View
                className="h-5 w-5 items-center justify-center rounded-md"
                style={{
                  backgroundColor: privacyAck ? "#f9363c" : "transparent",
                  borderWidth: privacyAck ? 0 : 1.5,
                  borderColor: "rgba(249, 54, 60, 0.5)",
                }}
              >
                {privacyAck ? (
                  <Check size={14} color="#fff" strokeWidth={3} />
                ) : null}
              </View>
              <Text className="text-[14px] font-medium text-black">
                I understand
              </Text>
            </Pressable>
          </View>
        ) : null}
      </BottomSheetScrollView>

      {/* Confirm CTA */}
      <View
        style={{
          backgroundColor: "#fff",
          paddingTop: 16,
          paddingBottom: insets.bottom + 12,
          paddingHorizontal: 20,
        }}
      >
        <Pressable
          className="items-center justify-center"
          style={{
            height: 50,
            borderRadius: 78,
            backgroundColor: "#000",
            opacity: confirmDisabled ? 0.4 : 1,
          }}
          onPress={onConfirm}
          disabled={confirmDisabled}
          accessibilityRole="button"
          accessibilityLabel="Confirm send"
        >
          {isSending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text
              className="text-[16px] font-medium text-white"
              style={{ lineHeight: 20 }}
            >
              Confirm
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// --- Result step (sending / sent / error) ---

// Continuously rotating red spinner arc, shown while the transfer is in flight.
function SendingSpinner() {
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

function ResultStep({
  isSending,
  sendError,
  txSignature,
  amountInToken,
  tokenSymbol,
  recipientLabel,
  onClose,
}: {
  isSending: boolean;
  sendError: string | null;
  txSignature: string | null;
  amountInToken: number;
  tokenSymbol: string;
  recipientLabel: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  const status = isSending ? "sending" : sendError ? "error" : "success";

  const explorerUrl = txSignature
    ? `https://solscan.io/tx/${txSignature}${
        getSolanaEnv() === "mainnet" ? "" : `?cluster=${getSolanaEnv()}`
      }`
    : null;

  return (
    <View className="w-full" style={{ flex: 1 }}>
      {/* Toolbar */}
      <View className="w-full" style={{ paddingVertical: 16 }}>
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
              Send
            </Text>
            <Text
              className="text-[15px] font-normal"
              style={{ color: "rgba(60,60,67,0.6)", lineHeight: 20, marginTop: 2 }}
            >
              to {recipientLabel}
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
          {status === "sending" ? (
            <SendingSpinner />
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
              {status === "sending"
                ? "Sending..."
                : status === "success"
                  ? "Sent"
                  : "Transaction failed"}
            </Text>
            {status === "success" ? (
              <Text
                className="text-[17px] font-normal"
                style={{ lineHeight: 22, textAlign: "center", maxWidth: 300 }}
              >
                <Text className="text-black">
                  {formatTokenAmount(amountInToken)} {tokenSymbol}
                </Text>
                <Text style={{ color: "rgba(60,60,67,0.6)" }}>
                  {" successfully sent to "}
                </Text>
                <Text className="text-black">{recipientLabel}</Text>
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
                {status === "sending"
                  ? "You can close this screen and continue using the app"
                  : (sendError ?? "Something went wrong. Please try again.")}
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
          onPress={onClose}
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
