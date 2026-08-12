"use client";

import { hashes } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { hapticFeedback, useRawInitData } from "@telegram-apps/sdk-react";
import { ArrowDown, ArrowUp, Copy, RefreshCcw } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const Confetti = dynamic(() => import("react-confetti"), { ssr: false });

import { computePortfolioTotals } from "@loyal-labs/solana-wallet";
import { NATIVE_MINT } from "@solana/spl-token";

import { ScanIcon } from "@/components/ui/icons/ScanIcon";
import { ActionButton } from "@/components/wallet/ActionButton";
import ActivitySheet from "@/components/wallet/ActivitySheet";
import BalanceBackgroundPicker from "@/components/wallet/BalanceBackgroundPicker";
import BannerCarousel from "@/components/wallet/BannerCarousel";
import ReceiveSheet from "@/components/wallet/ReceiveSheet";
import SendSheet, { addRecentRecipient } from "@/components/wallet/SendSheet";
import SwapSheet, {
  type SecureFormValues,
  type SwapFormValues,
  type SwapView,
} from "@/components/wallet/SwapSheet";
import TokensSheet from "@/components/wallet/TokensSheet";
import TransactionDetailsSheet from "@/components/wallet/TransactionDetailsSheet";
import { useSwap } from "@/hooks/useSwap";
import {
  useDeviceSafeAreaTop,
  useTelegramSafeArea,
} from "@/hooks/useTelegramSafeArea";
import { DISPLAY_CURRENCY_KEY } from "@/lib/constants";
import { track } from "@/lib/core/analytics";
import {
  refundDeposit,
  transferTokens,
  transferTokensToUsername,
} from "@/lib/solana/deposits";
import {
  shieldTokens,
  unshieldTokens,
} from "@/lib/solana/deposits/loyal-deposits";
import { invalidatePrivateClient } from "@/lib/solana/deposits/private-client";
import { fetchDeposits } from "@/lib/solana/fetch-deposits";
import { fetchSolUsdPrice } from "@/lib/solana/fetch-sol-price";
import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import { formatAddress } from "@/lib/solana/wallet/formatters";
import {
  getWalletKeypair,
  getWalletProvider,
  getWalletPublicKey,
  sendSolTransaction,
} from "@/lib/solana/wallet/wallet-details";
import { sendString } from "@/lib/telegram/mini-app";
import { setCloudValue } from "@/lib/telegram/mini-app/cloud-storage";
import {
  cleanInitData,
  parseUsernameFromInitData,
} from "@/lib/telegram/mini-app/init-data-transform";
import { openQrScanner } from "@/lib/telegram/mini-app/qr-code";
import {
  createShareMessage,
  shareSavedInlineMessage,
} from "@/lib/telegram/mini-app/share-message";
import type {
  IncomingTransaction,
  Transaction,
  TransactionDetailsData,
} from "@/types/wallet";

import { ActivityFeed } from "./components/ActivityFeed";
import { BalanceCard } from "./components/BalanceCard";
import { PullToRefreshIndicator } from "./components/PullToRefreshIndicator";
import { StickyBalancePill } from "./components/StickyBalancePill";
import { TokensList } from "./components/TokensList";
import { useDisplayPreferences } from "./hooks/useDisplayPreferences";
import { useIncomingDeposits } from "./hooks/useIncomingDeposits";
import { usePullToRefresh } from "./hooks/usePullToRefresh";
import { useSolPrice } from "./hooks/useSolPrice";
import { useTelegramMainButton } from "./hooks/useTelegramMainButton";
import { useTelegramSetup } from "./hooks/useTelegramSetup";
import { useTokenHoldings } from "./hooks/useTokenHoldings";
import { useWalletBalance } from "./hooks/useWalletBalance";
import { useWalletInit } from "./hooks/useWalletInit";
import { useWalletTransactions } from "./hooks/useWalletTransactions";
import {
  getAnalyticsErrorProperties,
  getSendMethod,
  SEND_METHODS,
  SWAP_METHODS,
  type SwapMethod,
  WALLET_ANALYTICS_EVENTS,
  WALLET_ANALYTICS_PATH,
} from "./wallet-analytics";
import {
  mapDepositToIncomingTransaction,
  setCachedDisplayCurrency,
  setCachedIncomingTransactions,
  setCachedSolPrice,
  walletTransactionsCache,
} from "./wallet-cache";

hashes.sha512 = sha512;

export default function Home() {
  const rawInitData = useRawInitData();
  const { bottom: _safeBottom } = useTelegramSafeArea();
  // Get device safe area only (not content safe area) to align with native header buttons
  const safeAreaInsetTop = useDeviceSafeAreaTop();
  const [isSendSheetOpen, setSendSheetOpen] = useState(false);
  const [isSwapSheetOpen, setSwapSheetOpen] = useState(false);
  const [swapActiveTab, setSwapActiveTab] = useState<"swap" | "secure">("swap");
  const [swapView, setSwapView] = useState<SwapView>("main");
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swappedFromAmount, setSwappedFromAmount] = useState<
    number | undefined
  >(undefined);
  const [swappedFromSymbol, setSwappedFromSymbol] = useState<
    string | undefined
  >(undefined);
  const [swappedToAmount, setSwappedToAmount] = useState<number | undefined>(
    undefined
  );
  const [swappedToSymbol, setSwappedToSymbol] = useState<string | undefined>(
    undefined
  );
  const [swapFormValues, setSwapFormValues] = useState<SwapFormValues | null>(
    null
  );
  const [secureFormValues, setSecureFormValues] =
    useState<SecureFormValues | null>(null);
  const [secureDirection, setSecureDirection] = useState<"shield" | "unshield">(
    "shield"
  );
  const [isSwapping, setIsSwapping] = useState(false);
  const [sendStep, setSendStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [sentAmountSol, setSentAmountSol] = useState<number | undefined>(
    undefined
  );
  const [sendError, setSendError] = useState<string | null>(null);
  const [isReceiveSheetOpen, setReceiveSheetOpen] = useState(false);
  const [isActivitySheetOpen, setActivitySheetOpen] = useState(false);
  const [isTokensSheetOpen, setTokensSheetOpen] = useState(false);
  const [isTransactionDetailsSheetOpen, setTransactionDetailsSheetOpen] =
    useState(false);
  const {
    walletAddress,
    setWalletAddress,
    isLoading,
    walletError,
    retryWalletInit,
  } = useWalletInit();
  const { solBalanceLamports, refreshBalance } = useWalletBalance(walletAddress);
  const {
    portfolioSnapshot,
    tokenHoldings,
    isHoldingsLoading,
    refreshTokenHoldings,
  } = useTokenHoldings(walletAddress);
  const {
    walletTransactions,
    setWalletTransactions,
    isFetchingTransactions,
    loadWalletTransactions,
  } = useWalletTransactions(walletAddress);
  const {
    incomingTransactions,
    setIncomingTransactions,
    isFetchingDeposits,
    isClaimingTransaction,
    showClaimSuccess,
    setShowClaimSuccess,
    claimError,
    setClaimError,
    showConfetti,
    setShowConfetti,
    handleApproveTransaction,
  } = useIncomingDeposits({
    rawInitData,
    walletAddress,
    refreshBalance,
    refreshTokenHoldings,
    loadWalletTransactions,
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedRecipient, setSelectedRecipient] = useState<string>("");
  const [selectedTransaction, setSelectedTransaction] =
    useState<TransactionDetailsData | null>(null);
  // Keep original incoming transaction for claim functionality
  const [selectedIncomingTransaction, setSelectedIncomingTransaction] =
    useState<IncomingTransaction | null>(null);
  const [isSendFormValid, setIsSendFormValid] = useState(false);
  const [isSwapFormValid, setIsSwapFormValid] = useState(false);
  const [sendFormValues, setSendFormValues] = useState<{
    amount: string;
    recipient: string;
    isSecured: boolean;
  }>({
    amount: "",
    recipient: "",
    isSecured: false,
  });
  const [isSendingTransaction, setIsSendingTransaction] = useState(false);
  const {
    displayCurrency,
    setDisplayCurrency,
    balanceBg,
    bgLoaded,
    handleBgSelect,
  } = useDisplayPreferences();
  const [isBgPickerOpen, setBgPickerOpen] = useState(false);
  const { isMobilePlatform } = useTelegramSetup(rawInitData);
  const { solPriceUsd, setSolPriceUsd, isSolPriceLoading } = useSolPrice();
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });

  const balanceRef = useRef<HTMLDivElement>(null);

  const handleOpenSendSheet = useCallback((recipientName?: string) => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    track(WALLET_ANALYTICS_EVENTS.openSend, {
      path: WALLET_ANALYTICS_PATH,
    });
    setSendStep(1); // Reset step
    if (recipientName) {
      setSelectedRecipient(recipientName);
      setSendFormValues({
        amount: "",
        recipient: recipientName,
        isSecured: false,
      });
    } else {
      setSelectedRecipient("");
      setSendFormValues({ amount: "", recipient: "", isSecured: false });
    }
    setSendSheetOpen(true);
  }, []);

  const handleOpenReceiveSheet = useCallback(() => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    track(WALLET_ANALYTICS_EVENTS.openReceive, {
      path: WALLET_ANALYTICS_PATH,
    });
    setReceiveSheetOpen(true);
  }, []);

  const handleOpenSwapSheet = useCallback(() => {
    hapticFeedback.impactOccurred("light");
    track(WALLET_ANALYTICS_EVENTS.openSwap, {
      path: WALLET_ANALYTICS_PATH,
    });
    setSwapSheetOpen(true);
  }, []);
  const handleOpenWalletTransactionDetails = useCallback(
    (transaction: Transaction) => {
      if (hapticFeedback.impactOccurred.isAvailable()) {
        hapticFeedback.impactOccurred("light");
      }
      // Clear incoming transaction ref
      setSelectedIncomingTransaction(null);

      const detailsData: TransactionDetailsData = {
        id: transaction.id,
        type: transaction.type === "incoming" ? "incoming" : "outgoing",
        amountLamports: transaction.amountLamports,
        transferType: transaction.transferType,
        tokenMint: transaction.tokenMint,
        tokenAmount: transaction.tokenAmount,
        tokenDecimals: transaction.tokenDecimals,
        recipient: transaction.recipient,
        recipientUsername: undefined, // FIXME: parse transfer_to_username_deposit transaction types
        sender: transaction.sender,
        senderUsername: transaction.sender?.startsWith("@")
          ? transaction.sender
          : undefined,
        status:
          transaction.status ??
          (transaction.type === "pending" ? "pending" : "completed"),
        timestamp: transaction.timestamp,
        networkFeeLamports: transaction.networkFeeLamports,
        signature: transaction.signature,
        // Swap transaction fields
        swapFromSymbol: transaction.swapFromSymbol,
        swapToSymbol: transaction.swapToSymbol,
        swapToAmount: transaction.swapToAmount,
        swapToAmountUsd: transaction.swapToAmountUsd,
        // Secure/unshield transaction fields
        secureTokenSymbol: transaction.secureTokenSymbol,
        secureTokenIcon: transaction.secureTokenIcon,
        secureAmount: transaction.secureAmount,
        secureAmountUsd: transaction.secureAmountUsd,
      };
      setSelectedTransaction(detailsData);
      setTransactionDetailsSheetOpen(true);
    },
    []
  );

  const handleSendValidationChange = useCallback((isValid: boolean) => {
    setIsSendFormValid(isValid);
  }, []);

  const handleSendFormValuesChange = useCallback(
    (values: { amount: string; recipient: string; isSecured: boolean }) => {
      setSendFormValues(values);
    },
    []
  );

  const handleSendSheetChange = useCallback((open: boolean) => {
    if (!open && hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    setSendSheetOpen(open);
    if (!open) {
      setSendStep(1); // Reset step when closing
      setSelectedRecipient("");
      setSendFormValues({ amount: "", recipient: "", isSecured: false });
      setSentAmountSol(undefined); // Reset sent amount
      setSendError(null); // Reset send error
    }
  }, []);

  const handleSwapParamsChange = useCallback((params: SwapFormValues) => {
    setSwapFormValues(params);
  }, []);

  const handleSecureParamsChange = useCallback((params: SecureFormValues) => {
    setSecureFormValues(params);
    setSecureDirection(params.direction);
  }, []);

  const { executeSwap } = useSwap(getWalletKeypair);

  const handleSubmitSwap = useCallback(async () => {
    if (!swapFormValues || !isSwapFormValid || isSwapping) {
      return;
    }

    const swapMethod: SwapMethod = SWAP_METHODS.regular;
    setIsSwapping(true);
    hapticFeedback.impactOccurred("medium");

    try {
      const result = await executeSwap(swapFormValues);

      if (result.success) {
        setSwappedFromAmount(result.fromAmount);
        setSwappedFromSymbol(result.fromSymbol);
        setSwappedToAmount(result.toAmount);
        setSwappedToSymbol(result.toSymbol);
        setSwapError(null);
        setSwapView("result");
        track(WALLET_ANALYTICS_EVENTS.swapTokens, {
          path: WALLET_ANALYTICS_PATH,
          method: swapMethod,
          from_symbol: result.fromSymbol,
          to_symbol: result.toSymbol,
          from_amount: result.fromAmount,
          to_amount: result.toAmount,
        });

        // Inject swap transaction immediately for instant feedback
        if (result.signature && swapFormValues) {
          const swapTx: Transaction = {
            id: result.signature,
            type: "outgoing",
            transferType: "swap",
            amountLamports: 0,
            signature: result.signature,
            timestamp: Date.now(),
            status: "completed",
            swapFromMint: swapFormValues.fromMint,
            swapToMint: swapFormValues.toMint,
            swapFromSymbol: result.fromSymbol,
            swapToSymbol: result.toSymbol,
            swapToAmount: result.toAmount,
          };
          setWalletTransactions((prev) => {
            const updated = [swapTx, ...prev];
            if (walletAddress) {
              walletTransactionsCache.set(walletAddress, updated);
            }
            return updated;
          });
        }

        // Refresh balance after successful swap
        void refreshBalance(true);
      } else {
        setSwapError(result.error || "Swap failed");
        setSwapView("result");
        track(WALLET_ANALYTICS_EVENTS.swapTokensFailed, {
          path: WALLET_ANALYTICS_PATH,
          method: swapMethod,
          error_name: "SwapError",
          error_message: result.error || "Swap failed",
        });
      }
    } catch (error) {
      console.error("[swap] Error:", error);
      setSwapError(error instanceof Error ? error.message : "Swap failed");
      setSwapView("result");
      track(WALLET_ANALYTICS_EVENTS.swapTokensFailed, {
        path: WALLET_ANALYTICS_PATH,
        method: swapMethod,
        ...getAnalyticsErrorProperties(error),
      });
    } finally {
      setIsSwapping(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapFormValues, isSwapFormValid, isSwapping, executeSwap]);

  const handleSubmitSecure = useCallback(async () => {
    if (!secureFormValues || !isSwapFormValid || isSwapping) return;

    const swapMethod: SwapMethod = SWAP_METHODS.secure;
    setIsSwapping(true);
    hapticFeedback.impactOccurred("medium");

    try {
      const tokenMint = new PublicKey(secureFormValues.mint);
      const rawAmount = Math.floor(
        secureFormValues.amount * Math.pow(10, secureFormValues.decimals)
      );

      if (secureDirection === "shield") {
        await shieldTokens({ tokenMint, amount: rawAmount });
      } else {
        await unshieldTokens({ tokenMint, amount: rawAmount });
      }

      setSwappedToAmount(secureFormValues.amount);
      setSwappedToSymbol(secureFormValues.symbol);
      setSwapError(null);
      setSwapView("result");
      track(WALLET_ANALYTICS_EVENTS.swapTokens, {
        path: WALLET_ANALYTICS_PATH,
        method: swapMethod,
        secure_direction: secureDirection,
        token_symbol: secureFormValues.symbol,
        amount: secureFormValues.amount,
      });
      void refreshBalance(true);
      void refreshTokenHoldings(true);
    } catch (error) {
      console.error("[secure] Error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Operation failed";
      // Recreate authToken for PER connection
      // Error: 500 : {"error":"error sending request for url (http://127.0.0.1:8899/)"}
      if (errorMessage.includes("http://127.0.0.1:8899/")) {
        void invalidatePrivateClient();
      }
      setSwapError(errorMessage);
      setSwapView("result");
      track(WALLET_ANALYTICS_EVENTS.swapTokensFailed, {
        path: WALLET_ANALYTICS_PATH,
        method: swapMethod,
        secure_direction: secureDirection,
        ...getAnalyticsErrorProperties(error),
      });
    } finally {
      setIsSwapping(false);
    }
  }, [
    secureDirection,
    secureFormValues,
    isSwapFormValid,
    isSwapping,
    refreshBalance,
    refreshTokenHoldings,
  ]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;

    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }

    setIsRefreshing(true);
    try {
      // Refresh wallet balance
      await refreshBalance(true);
      await refreshTokenHoldings(true);

      try {
        const latestPrice = await fetchSolUsdPrice();
        setCachedSolPrice(latestPrice);
        setSolPriceUsd(latestPrice);
      } catch (priceError) {
        console.error("Failed to refresh SOL price", priceError);
      }

      try {
        await loadWalletTransactions({ force: true });
      } catch (txError) {
        console.error("Failed to refresh wallet transactions", txError);
      }

      // Refresh incoming transactions
      if (rawInitData) {
        const cleanInitDataResult = cleanInitData(rawInitData);
        const mixedCaseUsername = parseUsernameFromInitData(cleanInitDataResult);

        if (mixedCaseUsername) {
          const username = mixedCaseUsername.toLowerCase();
          const provider = await getWalletProvider();
          const deposits = await fetchDeposits(
            provider.wallet.publicKey,
            username
          );

          const mappedTransactions = deposits.map(
            mapDepositToIncomingTransaction
          );
          setCachedIncomingTransactions(username, mappedTransactions);
          setIncomingTransactions(mappedTransactions);
        }
      }

      if (hapticFeedback.notificationOccurred.isAvailable()) {
        hapticFeedback.notificationOccurred("success");
      }
    } catch (error) {
      console.error("Failed to refresh data", error);
      if (hapticFeedback.notificationOccurred.isAvailable()) {
        hapticFeedback.notificationOccurred("error");
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [
    isRefreshing,
    loadWalletTransactions,
    rawInitData,
    refreshTokenHoldings,
    refreshBalance,
    setIncomingTransactions,
    setSolPriceUsd,
  ]);

  const anySheetOpen =
    isSendSheetOpen ||
    isSwapSheetOpen ||
    isReceiveSheetOpen ||
    isActivitySheetOpen ||
    isTokensSheetOpen ||
    isTransactionDetailsSheetOpen ||
    isBgPickerOpen;

  const {
    pullDistance,
    isRefreshing: isPullRefreshing,
    containerRef,
  } = usePullToRefresh({
    onRefresh: handleRefresh,
    disabled: anySheetOpen,
  });

  const handleSubmitSend = useCallback(async () => {
    if (!isSendFormValid || isSendingTransaction) {
      return;
    }

    const trimmedRecipient = sendFormValues.recipient.trim();
    const sendMethod = getSendMethod(trimmedRecipient);
    const amountSol = parseFloat(sendFormValues.amount);
    if (Number.isNaN(amountSol) || amountSol <= 0) {
      return;
    }

    const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);
    if (lamports <= 0) {
      console.warn("Lamports must be greater than zero");
      return;
    }

    setIsSendingTransaction(true);

    try {
      let signature: string | null = null;

      if (sendMethod === SEND_METHODS.walletAddress) {
        if (sendFormValues.isSecured) {
          const destinationUser = new PublicKey(trimmedRecipient);

          // Transfer via privateClient
          signature = await transferTokens({
            tokenMint: NATIVE_MINT,
            amount: lamports,
            destination: destinationUser,
          });
        } else {
          signature = await sendSolTransaction(trimmedRecipient, lamports);
        }
      } else if (sendMethod === SEND_METHODS.telegram) {
        const username = trimmedRecipient.replace(/^@/, "").toLowerCase();
        signature = await transferTokensToUsername({
          tokenMint: NATIVE_MINT,
          amount: lamports,
          destinationUsername: username,
        });
      } else {
        throw new Error("Invalid recipient");
      }

      await refreshBalance(true);
      if (signature) {
        void loadWalletTransactions({ force: true });
      }

      if (hapticFeedback.notificationOccurred.isAvailable()) {
        hapticFeedback.notificationOccurred("success");
      }

      // Save recipient to recent list
      void addRecentRecipient(trimmedRecipient);

      // Calculate and save the sent amount in SOL for the success screen
      const sentSolAmount = lamports / LAMPORTS_PER_SOL;
      setSentAmountSol(sentSolAmount);
      track(WALLET_ANALYTICS_EVENTS.sendFunds, {
        path: WALLET_ANALYTICS_PATH,
        method: sendMethod,
        amount_sol: sentSolAmount,
        amount_lamports: lamports,
      });
    } catch (error) {
      console.error("Failed to send transaction", error);
      if (hapticFeedback.notificationOccurred.isAvailable()) {
        hapticFeedback.notificationOccurred("error");
      }
      track(WALLET_ANALYTICS_EVENTS.sendFundsFailed, {
        path: WALLET_ANALYTICS_PATH,
        method: sendMethod,
        ...getAnalyticsErrorProperties(error),
      });

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.";
      // Recreate authToken for PER connection
      // Error: 500 : {"error":"error sending request for url (http://127.0.0.1:8899/)"}
      if (errorMessage.includes("http://127.0.0.1:8899/")) {
        void invalidatePrivateClient();
      }
      setSendError(errorMessage);
    } finally {
      setIsSendingTransaction(false);
    }
  }, [
    isSendFormValid,
    isSendingTransaction,
    sendFormValues,
    loadWalletTransactions,
    refreshBalance,
  ]);

  const handleReceiveSheetChange = useCallback((open: boolean) => {
    if (!open && hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    setReceiveSheetOpen(open);
  }, []);

  const handleOpenActivitySheet = useCallback(() => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    setActivitySheetOpen(true);
  }, []);

  const handleActivitySheetChange = useCallback((open: boolean) => {
    if (!open && hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    setActivitySheetOpen(open);
  }, []);

  const handleTransactionDetailsSheetChange = useCallback(
    (open: boolean) => {
      if (!open && hapticFeedback.impactOccurred.isAvailable()) {
        hapticFeedback.impactOccurred("light");
      }
      setTransactionDetailsSheetOpen(open);
      if (!open) {
        setSelectedTransaction(null);
        setSelectedIncomingTransaction(null);
        setShowClaimSuccess(false); // Reset claim success state
        setClaimError(null); // Reset claim error state
        setShowConfetti(false); // Reset confetti state
      }
    },
    [setClaimError, setShowClaimSuccess, setShowConfetti]
  );

  // Handle canceling (refunding) a deposit_for_username transaction
  const handleCancelDeposit = useCallback(
    async (username: string, amount: number) => {
      try {
        const provider = await getWalletProvider();
        await refundDeposit(provider, username, amount);

        if (hapticFeedback.notificationOccurred.isAvailable()) {
          hapticFeedback.notificationOccurred("success");
        }

        // Close the modal and refresh data
        setTransactionDetailsSheetOpen(false);
        setSelectedTransaction(null);

        // Refresh balance and transactions
        void refreshBalance(true);
      } catch (error) {
        console.error("Failed to refund deposit:", error);
        if (hapticFeedback.notificationOccurred.isAvailable()) {
          hapticFeedback.notificationOccurred("error");
        }
        throw error; // Re-throw so the sheet can handle it
      }
    },
    [refreshBalance]
  );

  const handleShareAddress = useCallback(async () => {
    try {
      const address =
        walletAddress ??
        (await getWalletPublicKey().then((publicKey) => {
          const base58 = publicKey.toBase58();
          setWalletAddress((prev) => prev ?? base58);
          return base58;
        }));

      if (!address) {
        console.warn("Wallet address unavailable");
        return;
      }

      const canUseShare =
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        (typeof window === "undefined" || window.isSecureContext);

      if (canUseShare) {
        try {
          await navigator.share({
            title: "My Solana address",
            text: address,
          });
          return;
        } catch (shareError) {
          if (
            shareError instanceof DOMException &&
            (shareError.name === "AbortError" ||
              shareError.name === "NotAllowedError")
          ) {
            return;
          }
        }
      }

      if (navigator?.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(address);
          return;
        } catch (copyError) {
          console.warn("Clipboard copy failed", copyError, address);
        }
      }

      if (sendString(address)) {
      }
    } catch (error) {
      console.error("Failed to share wallet address", error);
    }
  }, [setWalletAddress, walletAddress]);

  const handleShareDepositTransaction = useCallback(async () => {
    if (!selectedTransaction || !rawInitData || !solPriceUsd) {
      console.error(
        "Failed to share deposit transaction: missing required data"
      );
      return;
    }

    // Get recipient username from transaction (remove @ prefix if present)
    const recipientUsername =
      selectedTransaction.recipientUsername?.replace(/^@/, "") || "";
    if (!recipientUsername) {
      console.error(
        "Failed to share deposit transaction: missing recipient username"
      );
      return;
    }

    try {
      const amountSol = selectedTransaction.amountLamports / LAMPORTS_PER_SOL;
      const amountUsd = amountSol * solPriceUsd;
      const isSecure =
        selectedTransaction.transferType === "secure" ||
        !!selectedTransaction.secureTokenSymbol;

      const msgId = await createShareMessage(
        rawInitData,
        recipientUsername,
        amountSol,
        amountUsd,
        isSecure
      );

      if (msgId) {
        await shareSavedInlineMessage(msgId);
      }
    } catch (error) {
      console.error("Failed to share deposit transaction", error);
    }
  }, [selectedTransaction, rawInitData, solPriceUsd]);

  const handleScanQR = useCallback(() => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    void openQrScanner();
  }, []);

  const handleSwapTabChange = useCallback((tab: "swap" | "secure") => {
    setSwapActiveTab(tab);
    if (tab === "secure") {
      track(WALLET_ANALYTICS_EVENTS.openSecureSwap, {
        path: WALLET_ANALYTICS_PATH,
      });
    }
  }, []);

  useTelegramMainButton({
    isTransactionDetailsSheetOpen,
    isSendSheetOpen,
    isSwapSheetOpen,
    isReceiveSheetOpen,
    isBgPickerOpen,
    isSendFormValid,
    isSwapFormValid,
    isSendingTransaction,
    isSwapping,
    isClaimingTransaction,
    selectedTransaction,
    selectedIncomingTransaction,
    showClaimSuccess,
    claimError,
    sendStep,
    sendError,
    sentAmountSol,
    sendFormValues,
    swapView,
    swapActiveTab,
    secureDirection,
    rawInitData,
    solPriceUsd,
    handleOpenSendSheet,
    handleOpenReceiveSheet,
    handleShareAddress,
    handleApproveTransaction,
    handleSubmitSend,
    handleSubmitSwap,
    handleSubmitSecure,
    setSendSheetOpen,
    setSendStep,
    setSwapSheetOpen,
    setSwapView,
    setSwapActiveTab,
    setSwapError,
    setSwappedFromAmount,
    setSwappedFromSymbol,
    setSwappedToAmount,
    setSwappedToSymbol,
    setTransactionDetailsSheetOpen,
    setSelectedTransaction,
    setSelectedIncomingTransaction,
    setShowClaimSuccess,
    setClaimError,
    setIsSwapping,
    setIsSendingTransaction,
  });

  const portfolioTotals = useMemo(
    () => computePortfolioTotals(portfolioSnapshot?.positions ?? [], solPriceUsd),
    [portfolioSnapshot?.positions, solPriceUsd]
  );

  const showBalanceSkeleton =
    isLoading ||
    isHoldingsLoading ||
    (displayCurrency === "SOL" && portfolioTotals.totalSol === null);
  const showSecondarySkeleton =
    isLoading ||
    isHoldingsLoading ||
    (displayCurrency === "USD" && portfolioTotals.totalSol === null);
  // Computed numeric values for NumberFlow animations (portfolio totals)
  const usdBalanceNumeric = portfolioTotals.totalUsd;
  const solBalanceNumeric = portfolioTotals.totalSol ?? 0;

  // Combine and limit transactions for main Activity section (max 10)
  const limitedActivityItems = useMemo(() => {
    const items: Array<
      | { type: "incoming"; transaction: IncomingTransaction }
      | { type: "wallet"; transaction: Transaction }
    > = [];

    // Add incoming (claimable) transactions first - they have priority
    for (const tx of incomingTransactions) {
      items.push({ type: "incoming", transaction: tx });
    }

    // Add wallet transactions sorted by timestamp
    const sortedWallet = [...walletTransactions].sort(
      (a, b) => b.timestamp - a.timestamp
    );
    for (const tx of sortedWallet) {
      items.push({ type: "wallet", transaction: tx });
    }

    // Limit to 10
    return items.slice(0, 10);
  }, [incomingTransactions, walletTransactions]);

  // Track window size for confetti
  useEffect(() => {
    const updateSize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const handleToggleCurrency = useCallback(() => {
    if (hapticFeedback.selectionChanged.isAvailable()) {
      hapticFeedback.selectionChanged();
    }
    setDisplayCurrency((prev) => {
      const newCurrency = prev === "USD" ? "SOL" : "USD";
      setCachedDisplayCurrency(newCurrency);
      void setCloudValue(DISPLAY_CURRENCY_KEY, newCurrency);
      return newCurrency;
    });
  }, [setDisplayCurrency]);

  return (
    <>
      {/* Confetti for claim success */}
      {showConfetti && (
        <Confetti
          width={windowSize.width}
          height={windowSize.height}
          recycle={false}
          numberOfPieces={500}
          gravity={0.2}
          initialVelocityX={8}
          initialVelocityY={25}
          tweenDuration={100}
          style={{ position: "fixed", top: 0, left: 0, zIndex: 100 }}
          onConfettiComplete={() => setShowConfetti(false)}
        />
      )}
      <main
        className="min-h-screen font-sans overflow-hidden relative flex flex-col max-w-md mx-auto w-full"
        style={{ background: "#fff" }}
      >
        <StickyBalancePill
          safeAreaInsetTop={safeAreaInsetTop}
          displayCurrency={displayCurrency}
          usdBalance={usdBalanceNumeric}
          solBalance={solBalanceNumeric}
          visible={!showBalanceSkeleton}
          balanceRef={balanceRef}
        />

        {/* Main Content */}
        <div
          ref={containerRef}
          className="relative flex-1 flex flex-col w-full"
          style={{
            transform:
              pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
            transition:
              pullDistance > 0 && !isPullRefreshing
                ? "none"
                : "transform 0.3s cubic-bezier(0.2, 0, 0, 1)",
          }}
        >
          <PullToRefreshIndicator
            pullDistance={pullDistance}
            isRefreshing={isPullRefreshing}
            threshold={80}
          />
          <BalanceCard
            balanceRef={balanceRef}
            walletAddress={walletAddress}
            isLoading={isLoading}
            walletError={walletError}
            onRetry={retryWalletInit}
            balanceBg={balanceBg}
            bgLoaded={bgLoaded}
            displayCurrency={displayCurrency}
            usdBalance={usdBalanceNumeric}
            solBalance={solBalanceNumeric}
            showBalanceSkeleton={showBalanceSkeleton}
            showSecondarySkeleton={showSecondarySkeleton}
            onToggleCurrency={handleToggleCurrency}
            onOpenBgPicker={() => setBgPickerOpen(true)}
          />

          {/* Action Buttons */}
          <div className="flex items-center px-4 pt-5 pb-4">
            <ActionButton
              icon={<ArrowUp />}
              label="Send"
              onClick={() => handleOpenSendSheet()}
              disabled={solBalanceLamports === null || solBalanceLamports === 0}
            />
            <ActionButton
              icon={<ArrowDown />}
              label="Receive"
              onClick={handleOpenReceiveSheet}
            />
            <ActionButton
              icon={<RefreshCcw />}
              label="Swap"
              onClick={handleOpenSwapSheet}
            />
            <ActionButton
              icon={<ScanIcon />}
              label={isMobilePlatform ? "Scan" : "Mobile only"}
              onClick={handleScanQR}
              disabled={!isMobilePlatform}
            />
          </div>

          {/* Banner Carousel */}
          <BannerCarousel isMobilePlatform={isMobilePlatform} />

          <TokensList
            tokenHoldings={tokenHoldings}
            solPriceUsd={solPriceUsd}
            onShowAll={() => setTokensSheetOpen(true)}
          />

          <ActivityFeed
            limitedActivityItems={limitedActivityItems}
            incomingTransactions={incomingTransactions}
            walletTransactions={walletTransactions}
            tokenHoldings={tokenHoldings}
            isLoading={isLoading}
            isFetchingTransactions={isFetchingTransactions}
            isFetchingDeposits={isFetchingDeposits}
            onTransactionClick={handleOpenWalletTransactionDetails}
            onShowAll={handleOpenActivitySheet}
          />
        </div>

        {/* Bottom Fade Gradient */}
        <div
          className="fixed bottom-0 left-0 right-0 h-32 z-40 pointer-events-none"
          style={{
            background: "linear-gradient(to bottom, transparent, #fff)",
          }}
        />
      </main>

      <SendSheet
        open={isSendSheetOpen}
        onOpenChange={handleSendSheetChange}
        initialRecipient={selectedRecipient}
        onValidationChange={handleSendValidationChange}
        onFormValuesChange={handleSendFormValuesChange}
        step={sendStep}
        onStepChange={setSendStep}
        balance={solBalanceLamports}
        walletAddress={walletAddress ?? undefined}
        solPriceUsd={solPriceUsd}
        isSolPriceLoading={isSolPriceLoading}
        sentAmountSol={sentAmountSol}
        sendError={sendError}
        isSending={isSendingTransaction}
        tokenHoldings={tokenHoldings}
      />
      <SwapSheet
        open={isSwapSheetOpen}
        onOpenChange={(open) => {
          setSwapSheetOpen(open);
          if (!open) {
            // Reset swap state when closing
            setSwapView("main");
            setSwapActiveTab("swap");
            setSwapError(null);
            setSwappedFromAmount(undefined);
            setSwappedFromSymbol(undefined);
            setSwappedToAmount(undefined);
            setSwappedToSymbol(undefined);
            setSecureDirection("shield");
            setSecureFormValues(null);
          }
        }}
        tokenHoldings={tokenHoldings}
        solPriceUsd={solPriceUsd}
        onValidationChange={setIsSwapFormValid}
        onSwapParamsChange={handleSwapParamsChange}
        onSecureParamsChange={handleSecureParamsChange}
        activeTab={swapActiveTab}
        onTabChange={handleSwapTabChange}
        secureDirection={secureDirection}
        onSecureDirectionChange={setSecureDirection}
        view={swapView}
        onViewChange={setSwapView}
        swapError={swapError}
        swappedFromAmount={swappedFromAmount}
        swappedFromSymbol={swappedFromSymbol}
        swappedToAmount={swappedToAmount}
        swappedToSymbol={swappedToSymbol}
        isSwapping={isSwapping}
      />
      <ReceiveSheet
        open={isReceiveSheetOpen}
        onOpenChange={handleReceiveSheetChange}
        walletAddress={walletAddress ?? undefined}
      />
      <TransactionDetailsSheet
        open={isTransactionDetailsSheetOpen}
        onOpenChange={handleTransactionDetailsSheetChange}
        transaction={selectedTransaction}
        showSuccess={showClaimSuccess}
        showError={claimError}
        solPriceUsd={solPriceUsd}
        tokenHoldings={tokenHoldings}
        onShare={
          selectedTransaction?.transferType === "transfer_to_username_deposit"
            ? handleShareDepositTransaction
            : undefined
        }
        onCancelDeposit={handleCancelDeposit}
        swapFromSymbol={selectedTransaction?.swapFromSymbol}
        swapToSymbol={selectedTransaction?.swapToSymbol}
        swapToAmount={selectedTransaction?.swapToAmount}
        swapToAmountUsd={selectedTransaction?.swapToAmountUsd}
        secureTokenSymbol={selectedTransaction?.secureTokenSymbol}
        secureTokenIcon={selectedTransaction?.secureTokenIcon}
        secureAmount={selectedTransaction?.secureAmount}
        secureAmountUsd={selectedTransaction?.secureAmountUsd}
      />
      <ActivitySheet
        open={isActivitySheetOpen}
        onOpenChange={handleActivitySheetChange}
        walletTransactions={walletTransactions}
        incomingTransactions={incomingTransactions}
        onTransactionClick={handleOpenWalletTransactionDetails}
        tokenHoldings={tokenHoldings}
        isLoading={
          (isFetchingTransactions && walletTransactions.length === 0) ||
          (isFetchingDeposits && incomingTransactions.length === 0)
        }
      />
      <TokensSheet
        open={isTokensSheetOpen}
        onOpenChange={setTokensSheetOpen}
        tokenHoldings={tokenHoldings}
      />
      <BalanceBackgroundPicker
        open={isBgPickerOpen}
        onOpenChange={setBgPickerOpen}
        selectedBg={balanceBg}
        onSelect={handleBgSelect}
      >
        {(previewBg) => {
          const mainColor = previewBg ? "white" : "#1c1c1e";
          const decimalColor = previewBg ? "white" : "rgba(60, 60, 67, 0.6)";
          const value =
            displayCurrency === "USD" ? usdBalanceNumeric : solBalanceNumeric;
          const decimals = displayCurrency === "USD" ? 2 : 4;
          const prefix = displayCurrency === "USD" ? "$" : "";
          const suffix = displayCurrency === "SOL" ? " SOL" : "";
          const intPart = Math.floor(value);
          const decimalDigits = Math.round(
            Math.abs(value - intPart) * Math.pow(10, decimals)
          );
          const decimalStr = String(decimalDigits).padStart(decimals, "0");
          return (
            <>
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1">
                  <Copy
                    className="w-5 h-5"
                    strokeWidth={1.5}
                    style={{ color: decimalColor }}
                  />
                  <span
                    className="text-[17px] leading-[22px]"
                    style={{ color: decimalColor }}
                  >
                    {walletAddress
                      ? formatAddress(walletAddress)
                      : "Loading..."}
                  </span>
                </div>
                <span
                  className="text-[13px] leading-[18px] capitalize pl-0.5"
                  style={{
                    color: previewBg
                      ? "rgba(255, 255, 255, 0.7)"
                      : "rgba(60, 60, 67, 0.45)",
                  }}
                >
                  Solana {getSolanaEnv()}
                </span>
              </div>
              <div className="flex-1" />
              <div className="flex flex-col gap-1.5">
                <span
                  className="font-semibold inline-flex items-baseline"
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: "48px",
                    color: mainColor,
                  }}
                >
                  {prefix && <span className="text-[40px]">{prefix}</span>}
                  <span className="text-[40px]">
                    {intPart.toLocaleString("en-US")}
                  </span>
                  <span className="text-[28px]" style={{ color: decimalColor }}>
                    .{decimalStr}
                    {suffix}
                  </span>
                </span>
                <span
                  className="text-[17px] leading-[22px]"
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    color: decimalColor,
                  }}
                >
                  {displayCurrency === "USD"
                    ? `${solBalanceNumeric.toLocaleString("en-US", {
                        minimumFractionDigits: 4,
                        maximumFractionDigits: 4,
                      })} SOL`
                    : `$${usdBalanceNumeric.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`}
                </span>
              </div>
            </>
          );
        }}
      </BalanceBackgroundPicker>
    </>
  );
}
