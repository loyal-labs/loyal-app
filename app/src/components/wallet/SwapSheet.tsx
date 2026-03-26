"use client";

import { hapticFeedback, retrieveLaunchParams } from "@telegram-apps/sdk-react";
import { ArrowDownUp, ArrowLeft, ChevronRight, Search, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useTelegramSafeArea } from "@/hooks/useTelegramSafeArea";
import {
  NATIVE_SOL_MINT,
  SOL_PRICE_USD,
  SOLANA_USDC_MINT_DEVNET,
  SOLANA_USDC_MINT_MAINNET,
  SOLANA_USDT_MINT_MAINNET,
} from "@/lib/constants";
import { fetchSolUsdPrice } from "@/lib/solana/fetch-sol-price";
import { getSolanaEnv } from "@/lib/solana/rpc/connection";
import {
  DEFAULT_TOKEN_ICON,
  KNOWN_TOKEN_ICONS,
  type TokenHolding,
} from "@/lib/solana/token-holdings";
import { hideAllButtons } from "@/lib/telegram/mini-app/buttons";

import {
  getMaxAmountWithFeeReserve,
  getSwapFeeReserveSol,
  getSwapFlowFeeProfile,
} from "./fee-reserve";

// iOS-style sheet timing (shared with other sheets)
const SHEET_TRANSITION = "transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)";
const OVERLAY_TRANSITION = "opacity 0.3s ease";

// Token type definition
export type Token = {
  symbol: string;
  name: string;
  icon: string;
  decimals: number;
  balance: number;
  priceUsd: number;
  mint?: string;
  isSecured?: boolean;
};

// Helpers

function getTokenIcon(holding: TokenHolding): string {
  return (
    holding.imageUrl ?? KNOWN_TOKEN_ICONS[holding.mint] ?? DEFAULT_TOKEN_ICON
  );
}

function getSafeTokenSymbol(holding: TokenHolding): string {
  const symbol =
    typeof holding.symbol === "string" ? holding.symbol.trim() : "";
  if (symbol.length > 0) return symbol;
  if (holding.mint === NATIVE_SOL_MINT) return "SOL";
  return "TOKEN";
}

function getSafeTokenName(holding: TokenHolding, symbol: string): string {
  const name = typeof holding.name === "string" ? holding.name.trim() : "";
  return name.length > 0 ? name : symbol;
}

function getTokenIconAlt(token: Pick<Token, "symbol" | "name">): string {
  const symbol = token.symbol?.trim();
  if (symbol) return `${symbol} token icon`;

  const name = token.name?.trim();
  if (name) return `${name} token icon`;

  return "Token icon";
}

function getMaxDecimals(symbol: string): number {
  return symbol === "SOL" ? 6 : 2;
}

function parseAmountInput(value: string, maxDecimals: number): string | null {
  const normalized = value.replace(",", ".");
  if (!/^[0-9]*\.?[0-9]*$/.test(normalized)) return null;
  if (normalized.includes(".")) {
    const [, dec] = normalized.split(".");
    if (dec && dec.length > maxDecimals) return null;
  }
  return normalized;
}

export type SwapFormValues = {
  fromMint: string;
  toMint: string;
  fromAmount: number;
  fromDecimals: number;
  toDecimals: number;
  fromSymbol: string;
  toSymbol: string;
};

export type SecureFormValues = {
  mint: string;
  amount: number;
  decimals: number;
  symbol: string;
  direction: "shield" | "unshield";
};

// Fallback tokens when user has insufficient holdings
const FALLBACK_TOKENS: Token[] = [
  {
    symbol: "SOL",
    name: "Solana",
    icon: "/tokens/solana-sol-logo.png",
    decimals: 9,
    balance: 0,
    priceUsd: SOL_PRICE_USD,
    mint: NATIVE_SOL_MINT,
  },
  {
    symbol: "USDT",
    name: "Tether USD",
    icon: "/tokens/USDT.png",
    decimals: 6,
    balance: 0,
    priceUsd: 1,
    mint: SOLANA_USDT_MINT_MAINNET,
  },
  {
    symbol: "USDC",
    name: "USDC",
    icon: "/tokens/usd-coin-usdc-logo.png",
    decimals: 6,
    balance: 0,
    priceUsd: 1,
    mint:
      getSolanaEnv() == "devnet"
        ? SOLANA_USDC_MINT_DEVNET
        : SOLANA_USDC_MINT_MAINNET,
  },
];

function holdingToToken(holding: TokenHolding): Token {
  const symbol = getSafeTokenSymbol(holding);

  return {
    symbol,
    name: getSafeTokenName(holding, symbol),
    icon: getTokenIcon(holding),
    decimals: holding.decimals,
    balance: holding.balance,
    priceUsd: holding.priceUsd ?? 0,
    mint: holding.mint,
    isSecured: holding.isSecured,
  };
}

export type SwapView =
  | "main"
  | "selectFrom"
  | "selectTo"
  | "confirm"
  | "result";

export type SwapSheetProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  tokenHoldings?: TokenHolding[];
  solPriceUsd?: number | null;
  onValidationChange?: (isValid: boolean) => void;
  onSwapParamsChange?: (params: SwapFormValues) => void;
  onSecureParamsChange?: (params: SecureFormValues) => void;
  // Tab control
  activeTab?: "swap" | "secure";
  onTabChange?: (tab: "swap" | "secure") => void;
  // Secure direction control
  secureDirection?: "shield" | "unshield";
  onSecureDirectionChange?: (dir: "shield" | "unshield") => void;
  // Result state props
  view?: SwapView;
  onViewChange?: (view: SwapView) => void;
  swapError?: string | null;
  swappedFromAmount?: number;
  swappedFromSymbol?: string;
  swappedToAmount?: number;
  swappedToSymbol?: string;
  isSwapping?: boolean;
};

export default function SwapSheet({
  open,
  onOpenChange,
  tokenHoldings = [],
  solPriceUsd: solPriceUsdProp,
  onValidationChange,
  onSwapParamsChange,
  onSecureParamsChange,
  activeTab: activeTabProp,
  onTabChange,
  secureDirection: secureDirectionProp,
  onSecureDirectionChange,
  view: viewProp,
  onViewChange,
  swapError,
  swappedToAmount,
  swappedToSymbol,
  isSwapping = false,
}: SwapSheetProps) {
  const { bottom: safeBottom } = useTelegramSafeArea();
  const [mounted, setMounted] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [rendered, setRendered] = useState(false);
  const [show, setShow] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragDelta = useRef(0);
  const isDragging = useRef(false);
  const isClosing = useRef(false);

  // Detect iOS for platform-specific focus handling
  const [isIOS] = useState(() => {
    try {
      const params = retrieveLaunchParams();
      return params.tgWebAppPlatform === "ios";
    } catch {
      return false;
    }
  });

  // State
  const [internalActiveTab, setInternalActiveTab] = useState<"swap" | "secure">(
    "swap"
  );
  const [internalView, setInternalView] = useState<SwapView>("main");

  // Use controlled tab if provided, otherwise internal
  const activeTab = activeTabProp ?? internalActiveTab;
  const setActiveTab = useCallback(
    (newTab: "swap" | "secure") => {
      hapticFeedback.impactOccurred("light");
      if (onTabChange) {
        onTabChange(newTab);
      } else {
        setInternalActiveTab(newTab);
      }
    },
    [onTabChange]
  );

  // Use controlled view if provided, otherwise internal
  const view = viewProp ?? internalView;
  const setView = useCallback(
    (newView: SwapView) => {
      if (onViewChange) {
        onViewChange(newView);
      } else {
        setInternalView(newView);
      }
    },
    [onViewChange]
  );

  // Secure direction: shield or unshield
  const [internalSecureDirection, setInternalSecureDirection] = useState<
    "shield" | "unshield"
  >("shield");
  const secureDirection = secureDirectionProp ?? internalSecureDirection;
  const setSecureDirection = useCallback(
    (dir: "shield" | "unshield") => {
      if (onSecureDirectionChange) {
        onSecureDirectionChange(dir);
      } else {
        setInternalSecureDirection(dir);
      }
    },
    [onSecureDirectionChange]
  );

  const handleToggleSecureDirection = useCallback(() => {
    hapticFeedback.impactOccurred("light");
    setSecureDirection(secureDirection === "shield" ? "unshield" : "shield");
  }, [secureDirection, setSecureDirection]);

  // Compute available tokens from holdings or use fallback
  const availableTokens = useMemo(() => {
    if (tokenHoldings.length <= 1) {
      if (tokenHoldings.length === 1) {
        const userToken = holdingToToken(tokenHoldings[0]);
        const fallbackWithoutUserToken = FALLBACK_TOKENS.filter(
          (t) => t.mint !== userToken.mint
        );
        return [userToken, ...fallbackWithoutUserToken];
      }
      return FALLBACK_TOKENS;
    }
    return tokenHoldings.map(holdingToToken);
  }, [tokenHoldings]);
  const regularSolBalance =
    availableTokens.find(
      (token) => token.mint === NATIVE_SOL_MINT && token.isSecured !== true
    )?.balance ?? 0;

  // Secure mode state
  const [secureToken, setSecureToken] = useState<Token>(
    () => availableTokens[0] ?? FALLBACK_TOKENS[0]
  );
  const [secureAmountStr, setSecureAmountStr] = useState("");
  const secureAmountInputRef = useRef<HTMLInputElement>(null);
  const secureAmountTextRef = useRef<HTMLParagraphElement>(null);
  const [secureCaretLeft, setSecureCaretLeft] = useState(0);

  // Swap state
  const [fromToken, setFromToken] = useState<Token>(
    () => availableTokens[0] ?? FALLBACK_TOKENS[0]
  );
  const [toToken, setToToken] = useState<Token>(
    () => availableTokens[1] ?? FALLBACK_TOKENS[1]
  );
  const [amountStr, setAmountStr] = useState("");
  const [solPriceUsdState, setSolPriceUsdState] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const amountInputRef = useRef<HTMLInputElement>(null);
  const amountTextRef = useRef<HTMLParagraphElement>(null);
  const [caretLeft, setCaretLeft] = useState(0);

  // Use prop price or fetch
  const solPriceUsd = solPriceUsdProp ?? solPriceUsdState;

  // Switch secureToken to the correct variant when direction changes.
  // "shield" mode sources from regular token, "unshield" sources from secured token.
  useEffect(() => {
    if (activeTab !== "secure") return;

    const needsSecured = secureDirection === "unshield";
    const currentIsSecured = secureToken.isSecured === true;
    if (needsSecured === currentIsSecured) return;

    const counterpart = availableTokens.find(
      (t) =>
        t.mint === secureToken.mint && (t.isSecured === true) === needsSecured
    );

    if (counterpart) {
      setSecureToken({
        ...counterpart,
        priceUsd:
          counterpart.mint === NATIVE_SOL_MINT
            ? solPriceUsd ?? SOL_PRICE_USD
            : counterpart.priceUsd,
      });
    } else if (needsSecured) {
      // No secured counterpart — show 0 balance
      setSecureToken((prev) => ({ ...prev, balance: 0, isSecured: true }));
    } else {
      // Switching back to shield — restore regular variant
      const regular = availableTokens.find(
        (t) => t.mint === secureToken.mint && !t.isSecured
      );
      if (regular) {
        setSecureToken({
          ...regular,
          priceUsd:
            regular.mint === NATIVE_SOL_MINT
              ? solPriceUsd ?? SOL_PRICE_USD
              : regular.priceUsd,
        });
      }
    }
    setSecureAmountStr("");
  }, [
    secureDirection,
    activeTab,
    secureToken.mint,
    secureToken.isSecured,
    availableTokens,
    solPriceUsd,
  ]);

  // Update SOL price in tokens when available
  useEffect(() => {
    if (solPriceUsd) {
      setFromToken((prev) =>
        prev.mint === NATIVE_SOL_MINT
          ? { ...prev, priceUsd: solPriceUsd }
          : prev
      );
      setToToken((prev) =>
        prev.mint === NATIVE_SOL_MINT
          ? { ...prev, priceUsd: solPriceUsd }
          : prev
      );
      setSecureToken((prev) =>
        prev.mint === NATIVE_SOL_MINT
          ? { ...prev, priceUsd: solPriceUsd }
          : prev
      );
    }
  }, [solPriceUsd]);

  // Fetch SOL price if not provided
  useEffect(() => {
    if (solPriceUsdProp !== undefined) return;

    let isMounted = true;
    const loadPrice = async () => {
      try {
        const price = await fetchSolUsdPrice();
        if (isMounted) setSolPriceUsdState(price);
      } catch {
        if (isMounted) setSolPriceUsdState(SOL_PRICE_USD);
      }
    };
    void loadPrice();
    return () => {
      isMounted = false;
    };
  }, [solPriceUsdProp]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Open: mount elements, force layout, then trigger CSS transition
  useEffect(() => {
    if (open) {
      isClosing.current = false;
      setRendered(true);
    }
  }, [open]);

  useEffect(() => {
    if (rendered && open && !show && !isClosing.current) {
      sheetRef.current?.getBoundingClientRect();
      setShow(true);
    }
  }, [rendered, open, show]);

  // Measure header
  useEffect(() => {
    if (!open) return;
    const header = document.querySelector("header");
    if (header) {
      setHeaderHeight(header.getBoundingClientRect().bottom);
    }
  }, [open]);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setAmountStr("");
      setSecureAmountStr("");
      setSearchQuery("");
      setInternalView("main");
      setInternalActiveTab("swap");
      setInternalSecureDirection("shield");

      const firstToken = availableTokens[0] ?? FALLBACK_TOKENS[0];
      const secondToken =
        availableTokens[1] ??
        availableTokens.find((t) => t.mint !== firstToken.mint) ??
        FALLBACK_TOKENS[1];

      setFromToken({
        ...firstToken,
        priceUsd:
          firstToken.mint === NATIVE_SOL_MINT
            ? solPriceUsd ?? SOL_PRICE_USD
            : firstToken.priceUsd,
      });
      setToToken({
        ...secondToken,
        priceUsd:
          secondToken.mint === NATIVE_SOL_MINT
            ? solPriceUsd ?? SOL_PRICE_USD
            : secondToken.priceUsd,
      });
      setSecureToken({
        ...firstToken,
        priceUsd:
          firstToken.mint === NATIVE_SOL_MINT
            ? solPriceUsd ?? SOL_PRICE_USD
            : firstToken.priceUsd,
      });
    }
  }, [open, availableTokens, solPriceUsd]);

  // Focus amount input when sheet opens or returns to main view
  useEffect(() => {
    if (open && view === "main") {
      if (!isIOS) {
        const timer = setTimeout(() => {
          if (activeTab === "swap") {
            amountInputRef.current?.focus({ preventScroll: true });
          } else {
            secureAmountInputRef.current?.focus({ preventScroll: true });
          }
        }, 300);
        return () => clearTimeout(timer);
      }
    }
  }, [open, view, activeTab, isIOS]);

  // Update caret position for swap
  useEffect(() => {
    if (amountTextRef.current) {
      setCaretLeft(amountTextRef.current.offsetWidth);
    } else {
      setCaretLeft(0);
    }
  }, [amountStr]);

  // Update caret position for secure
  useEffect(() => {
    if (secureAmountTextRef.current) {
      setSecureCaretLeft(secureAmountTextRef.current.offsetWidth);
    } else {
      setSecureCaretLeft(0);
    }
  }, [secureAmountStr]);

  // Calculate receive amount
  const receiveAmount = useMemo(() => {
    const val = parseFloat(amountStr);
    if (isNaN(val) || val <= 0) return 0;
    const fromValueUsd = val * fromToken.priceUsd;
    const toAmount = fromValueUsd / toToken.priceUsd;
    return toAmount;
  }, [amountStr, fromToken.priceUsd, toToken.priceUsd]);

  // Format receive amount for display
  const receiveAmountDisplay = useMemo(() => {
    if (receiveAmount === 0) return "0";
    const decimals = toToken.symbol === "SOL" ? 6 : 2;
    return receiveAmount.toFixed(decimals).replace(/\.?0+$/, "") || "0";
  }, [receiveAmount, toToken.symbol]);

  // Calculate USD value of receive amount
  const receiveUsdValue = useMemo(() => {
    return receiveAmount * toToken.priceUsd;
  }, [receiveAmount, toToken.priceUsd]);

  const swapFeeProfile = getSwapFlowFeeProfile({
    activeTab: "swap",
    secureDirection,
    amountMint: fromToken.mint,
  });
  const swapFeeReserveSol = getSwapFeeReserveSol(swapFeeProfile.flow);
  const maxSwapAmount = getMaxAmountWithFeeReserve({
    assetBalance: fromToken.balance,
    feePayerSolBalance: regularSolBalance,
    feeReserveSol: swapFeeReserveSol,
    amountAndFeeUseSameSolBalance:
      swapFeeProfile.amountAndFeeUseSameSolBalance,
  });
  const secureFeeProfile = getSwapFlowFeeProfile({
    activeTab: "secure",
    secureDirection,
    amountMint: secureToken.mint,
  });
  const secureFeeReserveSol = getSwapFeeReserveSol(secureFeeProfile.flow);
  const maxSecureAmount = getMaxAmountWithFeeReserve({
    assetBalance: secureToken.balance,
    feePayerSolBalance: regularSolBalance,
    feeReserveSol: secureFeeReserveSol,
    amountAndFeeUseSameSolBalance:
      secureFeeProfile.amountAndFeeUseSameSolBalance,
  });

  // Check if swap is valid
  const isSwapValid = useMemo(() => {
    const val = parseFloat(amountStr);
    if (isNaN(val) || val <= 0) return false;
    if (val > maxSwapAmount) return false;
    return true;
  }, [amountStr, maxSwapAmount]);

  // Check if secure is valid
  const isSecureValid = useMemo(() => {
    const val = parseFloat(secureAmountStr);
    if (isNaN(val) || val <= 0) return false;
    if (val > maxSecureAmount) return false;
    return true;
  }, [secureAmountStr, maxSecureAmount]);

  // Calculate secure USD value
  const secureUsdValue = useMemo(() => {
    const val = parseFloat(secureAmountStr);
    if (isNaN(val) || val <= 0) return 0;
    return val * secureToken.priceUsd;
  }, [secureAmountStr, secureToken.priceUsd]);

  // Report validation state to parent
  useEffect(() => {
    if (open && view === "main") {
      const isValid = activeTab === "swap" ? isSwapValid : isSecureValid;
      onValidationChange?.(isValid);
    } else if (open && view === "confirm") {
      onValidationChange?.(true);
    } else {
      onValidationChange?.(false);
    }
  }, [open, view, activeTab, isSwapValid, isSecureValid, onValidationChange]);

  // Report swap params to parent
  useEffect(() => {
    if (open && activeTab === "swap" && fromToken.mint && toToken.mint) {
      const amount = parseFloat(amountStr);
      onSwapParamsChange?.({
        fromMint: fromToken.mint,
        toMint: toToken.mint,
        fromAmount: isNaN(amount) ? 0 : amount,
        fromDecimals: fromToken.decimals,
        toDecimals: toToken.decimals,
        fromSymbol: fromToken.symbol,
        toSymbol: toToken.symbol,
      });
    }
  }, [open, activeTab, fromToken, toToken, amountStr, onSwapParamsChange]);

  // Report secure params to parent
  useEffect(() => {
    if (open && activeTab === "secure" && secureToken.mint) {
      const amount = parseFloat(secureAmountStr);
      onSecureParamsChange?.({
        mint: secureToken.mint,
        amount: isNaN(amount) ? 0 : amount,
        decimals: secureToken.decimals,
        symbol: secureToken.symbol,
        direction: secureDirection,
      });
    }
  }, [
    open,
    activeTab,
    secureToken,
    secureAmountStr,
    secureDirection,
    onSecureParamsChange,
  ]);

  // Insufficient balance check (reserve gas fee when swapping from SOL)
  const insufficientBalance = useMemo(() => {
    const val = parseFloat(amountStr);
    if (isNaN(val) || val <= 0) return false;
    return val > maxSwapAmount;
  }, [amountStr, maxSwapAmount]);
  const secureInsufficientBalance = useMemo(() => {
    const val = parseFloat(secureAmountStr);
    if (isNaN(val) || val <= 0) return false;
    return val > maxSecureAmount;
  }, [maxSecureAmount, secureAmountStr]);

  // Swap from/to tokens
  const handleSwapTokens = useCallback(() => {
    hapticFeedback.impactOccurred("light");
    const temp = fromToken;
    setFromToken(toToken);
    setToToken(temp);
    if (amountStr) {
      const val = parseFloat(amountStr);
      if (!isNaN(val) && val > 0) {
        const fromValueUsd = val * fromToken.priceUsd;
        const newAmount = fromValueUsd / toToken.priceUsd;
        const decimals = toToken.symbol === "SOL" ? 6 : 2;
        setAmountStr(newAmount.toFixed(decimals).replace(/\.?0+$/, "") || "0");
      }
    }
  }, [fromToken, toToken, amountStr]);

  // Open token selector
  const handleOpenTokenSelect = useCallback(
    (type: "from" | "to") => {
      hapticFeedback.impactOccurred("light");
      setSearchQuery("");
      setView(type === "from" ? "selectFrom" : "selectTo");
    },
    [setView]
  );

  // Select token
  const handleSelectToken = useCallback(
    (token: Token, type: "from" | "to") => {
      hapticFeedback.impactOccurred("light");

      const currentFrom = fromToken;
      const currentTo = toToken;

      const tokenWithPrice = {
        ...token,
        priceUsd:
          token.mint === NATIVE_SOL_MINT
            ? solPriceUsd ?? SOL_PRICE_USD
            : token.priceUsd,
      };

      if (type === "from") {
        if (token.mint === currentTo.mint) {
          setToToken(currentFrom);
        }
        setFromToken(tokenWithPrice);
      } else {
        if (token.mint === currentFrom.mint) {
          setFromToken(currentTo);
        }
        setToToken(tokenWithPrice);
      }

      setView("main");
    },
    [fromToken, toToken, solPriceUsd, setView]
  );

  // Handle preset percentage (reserve gas fee for SOL at 100%)
  const handlePresetPercentage = useCallback(
    (percentage: number) => {
      hapticFeedback.impactOccurred("light");
      const amount =
        percentage === 100 ? maxSwapAmount : fromToken.balance * (percentage / 100);
      const formatted =
        amount
          .toFixed(getMaxDecimals(fromToken.symbol))
          .replace(/\.?0+$/, "") || "0";
      setAmountStr(formatted);
      amountInputRef.current?.focus({ preventScroll: true });
    },
    [fromToken.balance, fromToken.symbol, maxSwapAmount]
  );

  // Open secure token selector
  const handleOpenSecureTokenSelect = useCallback(() => {
    hapticFeedback.impactOccurred("light");
    setSearchQuery("");
    // Reuse selectFrom for secure token selection
    setView("selectFrom");
  }, [setView]);

  // Select secure token
  const handleSelectSecureToken = useCallback(
    (token: Token) => {
      hapticFeedback.impactOccurred("light");
      setSecureToken({
        ...token,
        priceUsd:
          token.mint === NATIVE_SOL_MINT
            ? solPriceUsd ?? SOL_PRICE_USD
            : token.priceUsd,
      });
      setView("main");
    },
    [solPriceUsd, setView]
  );

  // Handle secure preset percentage (reserve gas fee for SOL shield at 100%)
  const handleSecurePresetPercentage = useCallback(
    (percentage: number) => {
      hapticFeedback.impactOccurred("light");
      const amount =
        percentage === 100
          ? maxSecureAmount
          : secureToken.balance * (percentage / 100);
      const formatted =
        amount
          .toFixed(getMaxDecimals(secureToken.symbol))
          .replace(/\.?0+$/, "") || "0";
      setSecureAmountStr(formatted);
      secureAmountInputRef.current?.focus({ preventScroll: true });
    },
    [maxSecureAmount, secureToken.balance, secureToken.symbol]
  );

  // Handler wrappers for TokenSelectView callbacks
  const handleSelectFromToken = useCallback(
    (token: Token) => handleSelectToken(token, "from"),
    [handleSelectToken]
  );

  const handleSelectToToken = useCallback(
    (token: Token) => handleSelectToken(token, "to"),
    [handleSelectToken]
  );

  // Filter tokens: exclude the opposite token from the list
  const filteredFromTokens = useMemo(() => {
    let tokens = availableTokens.filter((t) => t.mint !== toToken.mint);
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      tokens = tokens.filter(
        (t) =>
          t.symbol.toLowerCase().includes(query) ||
          t.name.toLowerCase().includes(query)
      );
    }
    return tokens;
  }, [searchQuery, availableTokens, toToken.mint]);

  const filteredToTokens = useMemo(() => {
    let tokens = availableTokens.filter((t) => t.mint !== fromToken.mint);
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      tokens = tokens.filter(
        (t) =>
          t.symbol.toLowerCase().includes(query) ||
          t.name.toLowerCase().includes(query)
      );
    }
    return tokens;
  }, [searchQuery, availableTokens, fromToken.mint]);

  // Sheet animation handlers
  const unmount = useCallback(() => {
    setRendered(false);
    setShow(false);
    onOpenChange?.(false);
    isClosing.current = false;
  }, [onOpenChange]);

  const closeSheet = useCallback(() => {
    if (isClosing.current) return;
    isClosing.current = true;
    hideAllButtons();
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    if (sheetRef.current) {
      sheetRef.current.style.transition = SHEET_TRANSITION;
      sheetRef.current.style.transform = "translateY(100%)";
    }
    if (overlayRef.current) {
      overlayRef.current.style.transition = OVERLAY_TRANSITION;
      overlayRef.current.style.opacity = "0";
    }
  }, []);

  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
      if (e.propertyName === "transform" && isClosing.current) {
        unmount();
      }
    },
    [unmount]
  );

  // Close when parent sets open=false while sheet is still showing
  useEffect(() => {
    if (!open && rendered && show && !isClosing.current) {
      closeSheet();
    }
  }, [open, rendered, show, closeSheet]);

  // Pull-down-to-close
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    isDragging.current = true;
    dragStartY.current = e.touches[0].clientY;
    dragDelta.current = 0;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "none";
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const delta = e.touches[0].clientY - dragStartY.current;
    dragDelta.current = Math.max(0, delta);
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dragDelta.current}px)`;
    }
    if (overlayRef.current) {
      const opacity = Math.max(0.2, 1 - dragDelta.current / 300);
      overlayRef.current.style.opacity = String(opacity);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (dragDelta.current > 120) {
      closeSheet();
    } else {
      if (sheetRef.current) {
        sheetRef.current.style.transition = SHEET_TRANSITION;
        sheetRef.current.style.transform = "translateY(0px)";
      }
      if (overlayRef.current) {
        overlayRef.current.style.transition = OVERLAY_TRANSITION;
        overlayRef.current.style.opacity = "1";
      }
    }
    dragDelta.current = 0;
  }, [closeSheet]);

  // Lock body scroll
  useEffect(() => {
    if (rendered) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [rendered]);

  if (!mounted || !rendered) return null;

  const sheetTopOffset = headerHeight || 56;

  // Rate display for confirmation
  const rateDisplay = `1 ${toToken.symbol} ≈ ${(
    toToken.priceUsd / fromToken.priceUsd
  ).toFixed(fromToken.symbol === "SOL" ? 4 : 2)} ${fromToken.symbol}`;

  const content = (
    <>
      {/* Overlay */}
      <div
        ref={overlayRef}
        onClick={closeSheet}
        className="fixed inset-0 z-[9998]"
        style={{
          background: "rgba(0, 0, 0, 0.3)",
          opacity: show ? 1 : 0,
          transition: OVERLAY_TRANSITION,
        }}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        onTransitionEnd={handleTransitionEnd}
        className="fixed left-0 right-0 bottom-0 z-[9999] flex flex-col bg-white rounded-t-[38px] font-sans max-w-md mx-auto"
        style={{
          top: sheetTopOffset,
          transform: show ? "translateY(0)" : "translateY(100%)",
          transition: SHEET_TRANSITION,
          boxShadow: "0px -4px 40px rgba(0, 0, 0, 0.08)",
        }}
      >
        {/* Handle bar */}
        <div
          className="flex justify-center pt-2 pb-1 shrink-0 cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className="w-9 h-1 rounded-full"
            style={{ background: "rgba(0, 0, 0, 0.15)" }}
          />
        </div>

        {/* Header */}
        <div
          className="relative h-[44px] flex items-center justify-center shrink-0 px-4"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Back Button — confirm view */}
          {view === "confirm" && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                hapticFeedback.impactOccurred("light");
                setView("main");
              }}
              className="absolute left-3 p-1.5 rounded-full flex items-center justify-center active:scale-95 transition-all duration-150"
            >
              <ArrowLeft
                size={22}
                strokeWidth={1.5}
                style={{ color: "rgba(60, 60, 67, 0.6)" }}
              />
            </button>
          )}

          {/* Main view: Tabs */}
          {view === "main" && (
            <div
              className="flex items-center p-0.5 rounded-full"
              style={{ background: "#f2f2f7" }}
            >
              <button
                onClick={() => setActiveTab("swap")}
                className={`px-4 py-2 rounded-full text-[13px] leading-4 font-medium transition-all ${
                  activeTab === "swap"
                    ? "bg-white text-black shadow-sm"
                    : "text-black/40"
                }`}
              >
                Swap
              </button>
              <button
                onClick={() => setActiveTab("secure")}
                className={`px-4 py-2 rounded-full text-[13px] leading-4 font-medium transition-all ${
                  activeTab === "secure"
                    ? "bg-white text-black shadow-sm"
                    : "text-black/40"
                }`}
              >
                Secure
              </button>
            </div>
          )}

          {/* Token selection: Back button + title */}
          {(view === "selectFrom" || view === "selectTo") && (
            <>
              <button
                onClick={() => {
                  hapticFeedback.impactOccurred("light");
                  setView("main");
                }}
                className="absolute left-3 w-[30px] h-[30px] flex items-center justify-center active:scale-95 transition-all duration-150"
              >
                <Image
                  src="/icons/arrow-left.svg"
                  alt="Back"
                  width={30}
                  height={30}
                />
              </button>
              <span className="text-[17px] font-semibold text-black leading-[22px]">
                Select asset
              </span>
            </>
          )}

          {/* Confirm / Result: Title */}
          {(view === "confirm" || view === "result") && (
            <span className="text-[17px] font-semibold text-black leading-[22px]">
              {activeTab === "secure"
                ? `${secureDirection === "shield" ? "Secure" : "Unshield"} ${
                    secureToken.symbol
                  }`
                : `Swap ${fromToken.symbol} to ${toToken.symbol}`}
            </span>
          )}

          {/* Close Button */}
          <button
            onClick={closeSheet}
            className="absolute right-3 w-[30px] h-[30px] rounded-full flex items-center justify-center active:scale-95 transition-all duration-150"
            style={{ background: "rgba(0, 0, 0, 0.06)" }}
          >
            <X
              size={20}
              strokeWidth={2}
              style={{ color: "rgba(60, 60, 67, 0.6)" }}
            />
          </button>
        </div>

        {/* Content Container */}
        <div
          className="relative flex-1 overflow-hidden"
          style={{ paddingBottom: Math.max(safeBottom, 24) + 80 }}
        >
          {/* MAIN VIEW */}
          <div
            className="absolute inset-0 flex flex-col overflow-y-auto transition-all duration-300 ease-out"
            style={{
              transform: `translateX(${view === "main" ? 0 : -100}%)`,
              opacity: view === "main" ? 1 : 0,
              pointerEvents: view === "main" ? "auto" : "none",
            }}
          >
            {/* SWAP TAB CONTENT */}
            {activeTab === "swap" && (
              <div className="flex flex-col px-4 pt-2 pb-4 gap-2">
                {/* You Swap Card */}
                <div
                  className="flex flex-col px-4 py-3 rounded-[20px] relative"
                  style={{ background: "#f2f2f7" }}
                >
                  <p
                    className="text-base leading-5"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    You swap
                  </p>

                  <div className="flex gap-1 items-center h-12">
                    {/* Amount Input */}
                    <div className="flex-1 flex items-baseline relative">
                      <input
                        ref={amountInputRef}
                        type="text"
                        inputMode="decimal"
                        value={amountStr}
                        onChange={(e) => {
                          const parsed = parseAmountInput(
                            e.target.value,
                            getMaxDecimals(fromToken.symbol)
                          );
                          if (parsed !== null) {
                            setAmountStr(parsed);
                          }
                        }}
                        placeholder="0"
                        className="absolute inset-0 opacity-0 z-10"
                        autoComplete="off"
                      />
                      <p
                        ref={amountTextRef}
                        className="text-[28px] font-semibold leading-8"
                        style={{
                          color: insufficientBalance ? "#f9363c" : "#000",
                        }}
                      >
                        {amountStr || ""}
                      </p>
                      {!amountStr && (
                        <p className="text-[28px] font-semibold leading-8 text-black/30">
                          0
                        </p>
                      )}
                      {/* Caret */}
                      <div
                        className="absolute w-[1.5px] h-8 top-1/2 -translate-y-1/2"
                        style={{
                          left: `${caretLeft}px`,
                          background: "#f9363c",
                          animation: "blink 1s step-end infinite",
                        }}
                      />
                    </div>

                    {/* Token Selector */}
                    <button
                      onClick={() => handleOpenTokenSelect("from")}
                      className="flex items-center px-1 rounded-[54px] active:scale-95 transition-transform"
                      style={{ background: "rgba(0, 0, 0, 0.06)" }}
                    >
                      <div className="pr-1.5">
                        <div className="w-7 h-7 rounded-full overflow-hidden">
                          <Image
                            src={fromToken.icon}
                            alt={getTokenIconAlt(fromToken)}
                            width={28}
                            height={28}
                          />
                        </div>
                      </div>
                      <span className="text-base leading-5 text-black py-2.5 pr-1">
                        {fromToken.symbol}
                      </span>
                      <ChevronRight
                        size={16}
                        strokeWidth={1.5}
                        style={{ color: "rgba(60, 60, 67, 0.3)" }}
                      />
                    </button>
                  </div>

                  {/* Bottom Row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(0, 0, 0, 0.06)" }}
                      >
                        <ArrowDownUp
                          size={12}
                          strokeWidth={2}
                          style={{ color: "rgba(60, 60, 67, 0.6)" }}
                        />
                      </div>
                      <p
                        className="text-[13px] leading-4"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        1 {fromToken.symbol} ≈ ${fromToken.priceUsd.toFixed(4)}
                      </p>
                    </div>
                    <p
                      className="text-[13px] leading-4"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      {fromToken.balance.toLocaleString("en-US", {
                        maximumFractionDigits:
                          fromToken.symbol === "SOL" ? 4 : 2,
                      })}
                    </p>
                  </div>

                  {/* Swap Direction Button */}
                  <button
                    onClick={handleSwapTokens}
                    className="absolute -bottom-[18px] left-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-white flex items-center justify-center active:scale-95 transition-transform z-10 shadow-sm"
                    style={{ border: "1px solid rgba(0, 0, 0, 0.06)" }}
                  >
                    <ArrowDownUp
                      size={16}
                      strokeWidth={2}
                      className="text-black"
                    />
                  </button>
                </div>

                {/* You Receive Card */}
                <div
                  className="flex flex-col px-4 py-3 rounded-[20px]"
                  style={{ background: "#f2f2f7" }}
                >
                  <p
                    className="text-base leading-5"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    You receive
                  </p>

                  <div className="flex gap-1 items-center h-12">
                    <div className="flex-1 flex items-baseline">
                      <p
                        className={`text-[28px] font-semibold leading-8 ${
                          receiveAmount > 0 ? "text-black" : "text-black/30"
                        }`}
                      >
                        {receiveAmountDisplay}
                      </p>
                    </div>

                    {/* Token Selector */}
                    <button
                      onClick={() => handleOpenTokenSelect("to")}
                      className="flex items-center px-1 rounded-[54px] active:scale-95 transition-transform"
                      style={{ background: "rgba(0, 0, 0, 0.06)" }}
                    >
                      <div className="pr-1.5">
                        <div className="w-7 h-7 rounded-full overflow-hidden">
                          <Image
                            src={toToken.icon}
                            alt={getTokenIconAlt(toToken)}
                            width={28}
                            height={28}
                          />
                        </div>
                      </div>
                      <span className="text-base leading-5 text-black py-2.5 pr-1">
                        {toToken.symbol}
                      </span>
                      <ChevronRight
                        size={16}
                        strokeWidth={1.5}
                        style={{ color: "rgba(60, 60, 67, 0.3)" }}
                      />
                    </button>
                  </div>

                  {/* Bottom Row */}
                  <div className="flex items-center justify-between">
                    <p
                      className="text-[13px] leading-4"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      ${receiveUsdValue.toFixed(2)}
                    </p>
                    <p
                      className="text-[13px] leading-4"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      {toToken.balance.toLocaleString("en-US", {
                        maximumFractionDigits: toToken.symbol === "SOL" ? 4 : 2,
                      })}{" "}
                      {toToken.symbol}
                    </p>
                  </div>
                </div>

                {/* Percentage Buttons */}
                <div className="flex gap-2">
                  {[25, 50].map((pct) => (
                    <button
                      key={pct}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handlePresetPercentage(pct)}
                      className="flex-1 min-w-[64px] px-4 py-2 rounded-[40px] text-sm leading-5 text-center active:opacity-70 transition-opacity"
                      style={{
                        background: "rgba(249, 54, 60, 0.14)",
                        color: "#f9363c",
                      }}
                    >
                      {pct}%
                    </button>
                  ))}
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handlePresetPercentage(100)}
                    className="flex-1 min-w-[64px] px-4 py-2 rounded-[40px] text-sm leading-5 text-center active:opacity-70 transition-opacity"
                    style={{
                      background: "rgba(249, 54, 60, 0.14)",
                      color: "#f9363c",
                    }}
                  >
                    Max
                  </button>
                </div>

                {/* Insufficient balance error */}
                {insufficientBalance && (
                  <p
                    className="text-[13px] leading-4 px-1"
                    style={{ color: "#f9363c" }}
                  >
                    Insufficient balance
                  </p>
                )}
              </div>
            )}

            {/* SECURE TAB CONTENT */}
            {activeTab === "secure" && (
              <div className="flex flex-col px-4 pt-2 pb-4 gap-2">
                {/* First Card: "You secure" (shield) or "You unshield" (unshield) */}
                <div
                  className="flex flex-col px-4 py-3 rounded-[20px] relative"
                  style={{ background: "#f2f2f7" }}
                >
                  <p
                    className="text-base leading-5"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    {secureDirection === "shield"
                      ? "You secure"
                      : "You unshield"}
                  </p>

                  <div className="flex gap-1 items-center h-12">
                    <div className="flex-1 flex items-baseline relative">
                      <input
                        ref={secureAmountInputRef}
                        type="text"
                        inputMode="decimal"
                        value={secureAmountStr}
                        onChange={(e) => {
                          const parsed = parseAmountInput(
                            e.target.value,
                            getMaxDecimals(secureToken.symbol)
                          );
                          if (parsed !== null) {
                            setSecureAmountStr(parsed);
                          }
                        }}
                        placeholder="0"
                        className="absolute inset-0 opacity-0 z-10"
                        autoComplete="off"
                      />
                      <p
                        ref={secureAmountTextRef}
                        className="text-[28px] font-semibold leading-8 text-black"
                      >
                        {secureAmountStr || ""}
                      </p>
                      {!secureAmountStr && (
                        <p className="text-[28px] font-semibold leading-8 text-black/30">
                          0
                        </p>
                      )}
                      <div
                        className="absolute w-[1.5px] h-8 top-1/2 -translate-y-1/2"
                        style={{
                          left: `${secureCaretLeft}px`,
                          background: "#f9363c",
                          animation: "blink 1s step-end infinite",
                        }}
                      />
                    </div>

                    {/* Token selector (always selectable) */}
                    <button
                      onClick={handleOpenSecureTokenSelect}
                      className="flex items-center px-1 rounded-[54px] active:scale-95 transition-transform"
                      style={{ background: "rgba(0, 0, 0, 0.06)" }}
                    >
                      <div className="pr-1.5">
                        <div className="relative">
                          <div className="w-7 h-7 rounded-full overflow-hidden">
                            <Image
                              src={secureToken.icon}
                              alt={getTokenIconAlt(secureToken)}
                              width={28}
                              height={28}
                            />
                          </div>
                          {/* Shield badge for unshield mode */}
                          {secureDirection === "unshield" && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4">
                              <Image
                                src="/Shield.svg"
                                alt="Secured"
                                width={16}
                                height={16}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="text-base leading-5 text-black py-2.5 pr-1">
                        {secureToken.symbol}
                      </span>
                      <ChevronRight
                        size={16}
                        strokeWidth={1.5}
                        style={{ color: "rgba(60, 60, 67, 0.3)" }}
                      />
                    </button>
                  </div>

                  {/* Bottom Row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center"
                        style={{ background: "rgba(0, 0, 0, 0.06)" }}
                      >
                        <ArrowDownUp
                          size={12}
                          strokeWidth={2}
                          style={{ color: "rgba(60, 60, 67, 0.6)" }}
                        />
                      </div>
                      <p
                        className="text-[13px] leading-4"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        1 {secureToken.symbol} ≈ $
                        {secureToken.priceUsd.toFixed(4)}
                      </p>
                    </div>
                    <p
                      className="text-[13px] leading-4"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      {secureToken.balance.toLocaleString("en-US", {
                        maximumFractionDigits:
                          secureToken.symbol === "SOL" ? 4 : 2,
                      })}
                    </p>
                  </div>

                  {/* Swap Direction Button */}
                  <button
                    onClick={handleToggleSecureDirection}
                    className="absolute -bottom-[18px] left-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-white flex items-center justify-center active:scale-95 transition-transform z-10 shadow-sm"
                    style={{ border: "1px solid rgba(0, 0, 0, 0.06)" }}
                  >
                    <ArrowDownUp
                      size={16}
                      strokeWidth={2}
                      className="text-black"
                    />
                  </button>
                </div>

                {/* Second Card: "You receive" — border only, no fill */}
                <div
                  className="flex flex-col px-4 py-3 rounded-[20px]"
                  style={{ border: "1px solid rgba(0, 0, 0, 0.08)" }}
                >
                  <p
                    className="text-base leading-5"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    You receive
                  </p>

                  <div className="flex gap-1 items-center h-12">
                    <div className="flex-1 flex items-baseline">
                      <p
                        className={`text-[28px] font-semibold leading-8 ${
                          secureAmountStr ? "text-black" : "text-black/30"
                        }`}
                      >
                        {secureAmountStr || "0"}
                      </p>
                    </div>

                    {/* Token display (NOT selectable) */}
                    <div className="flex items-center px-1 pr-3.5">
                      <div className="flex items-center pr-1.5">
                        <div className="relative">
                          <div className="w-7 h-7 rounded-full overflow-hidden">
                            <Image
                              src={secureToken.icon}
                              alt={getTokenIconAlt(secureToken)}
                              width={28}
                              height={28}
                            />
                          </div>
                          {/* Shield badge for shield mode (receive side is secured) */}
                          {secureDirection === "shield" && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4">
                              <Image
                                src="/Shield.svg"
                                alt="Secured"
                                width={16}
                                height={16}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                      <span className="text-base leading-5 text-black py-2.5">
                        {secureToken.symbol}
                      </span>
                    </div>
                  </div>

                  {/* Bottom Row */}
                  <div className="flex items-center justify-between">
                    <p
                      className="text-[13px] leading-4"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      ${secureUsdValue.toFixed(2)}
                    </p>
                    <p
                      className="text-[13px] leading-4"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      0
                    </p>
                  </div>
                </div>

                {/* Percentage Buttons */}
                <div className="flex gap-2">
                  {[25, 50].map((pct) => (
                    <button
                      key={pct}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSecurePresetPercentage(pct)}
                      className="flex-1 min-w-[64px] px-4 py-2 rounded-[40px] text-sm leading-5 text-center active:opacity-70 transition-opacity"
                      style={{
                        background: "rgba(249, 54, 60, 0.14)",
                        color: "#f9363c",
                      }}
                    >
                      {pct}%
                    </button>
                  ))}
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSecurePresetPercentage(100)}
                    className="flex-1 min-w-[64px] px-4 py-2 rounded-[40px] text-sm leading-5 text-center active:opacity-70 transition-opacity"
                    style={{
                      background: "rgba(249, 54, 60, 0.14)",
                      color: "#f9363c",
                    }}
                  >
                    Max
                  </button>
                </div>

                {/* Insufficient balance error */}
                {secureInsufficientBalance && (
                  <p
                    className="text-[13px] leading-4 px-1"
                    style={{ color: "#f9363c" }}
                  >
                    Insufficient balance
                  </p>
                )}
              </div>
            )}
          </div>

          {/* TOKEN SELECT: FROM */}
          <div
            className="absolute inset-0 flex flex-col transition-all duration-300 ease-out"
            style={{
              transform: `translateX(${view === "selectFrom" ? 0 : 100}%)`,
              opacity: view === "selectFrom" ? 1 : 0,
              pointerEvents: view === "selectFrom" ? "auto" : "none",
            }}
          >
            {/* Search Input */}
            <div className="px-4 pt-2 pb-3 shrink-0">
              <div
                className="flex items-center rounded-[47px] px-4"
                style={{ background: "#f2f2f7" }}
              >
                <Search
                  size={20}
                  strokeWidth={1.5}
                  className="shrink-0 mr-2"
                  style={{ color: "rgba(60, 60, 67, 0.6)" }}
                />
                <input
                  type="text"
                  placeholder="Search token"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent py-3 text-[17px] leading-[22px] text-black placeholder:text-[rgba(60,60,67,0.6)] outline-none"
                />
              </div>
            </div>

            {/* Token List */}
            <div className="flex-1 overflow-y-auto">
              {filteredFromTokens.map((token) => (
                <button
                  key={`${token.mint ?? token.symbol}${
                    token.isSecured ? "-secured" : ""
                  }`}
                  onClick={() =>
                    activeTab === "secure"
                      ? handleSelectSecureToken(token)
                      : handleSelectFromToken(token)
                  }
                  className="w-full flex items-center px-4 active:bg-black/[0.03] transition-colors"
                >
                  <div className="py-1.5 pr-3">
                    <div className="w-12 h-12 relative">
                      <div className="w-12 h-12 rounded-full overflow-hidden bg-[#f2f2f7]">
                        <Image
                          src={token.icon}
                          alt={getTokenIconAlt(token)}
                          width={48}
                          height={48}
                        />
                      </div>
                      {token.isSecured && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-[20px] h-[20px]">
                          <Image
                            src="/Shield.svg"
                            alt="Secured"
                            width={20}
                            height={20}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col gap-0.5 py-2.5">
                    <p className="text-[17px] font-medium text-black leading-[22px] text-left">
                      {token.symbol}
                    </p>
                    <p
                      className="text-[15px] leading-5 text-left"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      $
                      {token.priceUsd.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                  <div className="flex flex-col gap-0.5 items-end py-2.5 pl-3">
                    <p className="text-[17px] text-black leading-[22px] text-right">
                      {token.balance.toLocaleString("en-US", {
                        maximumFractionDigits: token.decimals > 6 ? 4 : 2,
                      })}
                    </p>
                    <p
                      className="text-[15px] leading-5 text-right"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      $
                      {(token.balance * token.priceUsd).toLocaleString(
                        "en-US",
                        {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }
                      )}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* TOKEN SELECT: TO */}
          <div
            className="absolute inset-0 flex flex-col transition-all duration-300 ease-out"
            style={{
              transform: `translateX(${view === "selectTo" ? 0 : 100}%)`,
              opacity: view === "selectTo" ? 1 : 0,
              pointerEvents: view === "selectTo" ? "auto" : "none",
            }}
          >
            {/* Search Input */}
            <div className="px-4 pt-2 pb-3 shrink-0">
              <div
                className="flex items-center rounded-[47px] px-4"
                style={{ background: "#f2f2f7" }}
              >
                <Search
                  size={20}
                  strokeWidth={1.5}
                  className="shrink-0 mr-2"
                  style={{ color: "rgba(60, 60, 67, 0.6)" }}
                />
                <input
                  type="text"
                  placeholder="Search token"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent py-3 text-[17px] leading-[22px] text-black placeholder:text-[rgba(60,60,67,0.6)] outline-none"
                />
              </div>
            </div>

            {/* Token List */}
            <div className="flex-1 overflow-y-auto">
              {filteredToTokens.map((token) => (
                <button
                  key={`${token.mint ?? token.symbol}${
                    token.isSecured ? "-secured" : ""
                  }`}
                  onClick={() => handleSelectToToken(token)}
                  className="w-full flex items-center px-4 active:bg-black/[0.03] transition-colors"
                >
                  <div className="py-1.5 pr-3">
                    <div className="w-12 h-12 relative">
                      <div className="w-12 h-12 rounded-full overflow-hidden bg-[#f2f2f7]">
                        <Image
                          src={token.icon}
                          alt={getTokenIconAlt(token)}
                          width={48}
                          height={48}
                        />
                      </div>
                      {token.isSecured && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-[20px] h-[20px]">
                          <Image
                            src="/Shield.svg"
                            alt="Secured"
                            width={20}
                            height={20}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col gap-0.5 py-2.5">
                    <p className="text-[17px] font-medium text-black leading-[22px] text-left">
                      {token.symbol}
                    </p>
                    <p
                      className="text-[15px] leading-5 text-left"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      $
                      {token.priceUsd.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                  <div className="flex flex-col gap-0.5 items-end py-2.5 pl-3">
                    <p className="text-[17px] text-black leading-[22px] text-right">
                      {token.balance.toLocaleString("en-US", {
                        maximumFractionDigits: token.decimals > 6 ? 4 : 2,
                      })}
                    </p>
                    <p
                      className="text-[15px] leading-5 text-right"
                      style={{ color: "rgba(60, 60, 67, 0.6)" }}
                    >
                      $
                      {(token.balance * token.priceUsd).toLocaleString(
                        "en-US",
                        {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }
                      )}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* CONFIRMATION VIEW */}
          <div
            className="absolute inset-0 flex flex-col overflow-y-auto transition-all duration-300 ease-out"
            style={{
              transform: `translateX(${view === "confirm" ? 0 : 100}%)`,
              opacity: view === "confirm" ? 1 : 0,
              pointerEvents: view === "confirm" ? "auto" : "none",
            }}
          >
            {/* Amount Display */}
            <div className="px-4 pt-4 pb-2">
              <div className="px-2 flex flex-col gap-1">
                {/* From amount (negative) */}
                <div className="flex gap-2 items-baseline">
                  <p className="text-[32px] font-semibold leading-[38px] text-black">
                    −{amountStr || "0"}
                  </p>
                  <p
                    className="text-[22px] font-semibold leading-7 tracking-[0.4px]"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    {fromToken.symbol}
                  </p>
                </div>
                {/* To amount (positive, green) */}
                <div className="flex gap-2 items-baseline">
                  <p
                    className="text-[32px] font-semibold leading-[38px]"
                    style={{ color: "#34C759" }}
                  >
                    +{receiveAmountDisplay}
                  </p>
                  <p
                    className="text-[22px] font-semibold leading-7 tracking-[0.4px]"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    {toToken.symbol}
                  </p>
                </div>
                {/* USD equivalent */}
                <p
                  className="text-base leading-[22px] mt-1"
                  style={{ color: "rgba(60, 60, 67, 0.6)" }}
                >
                  ≈$
                  {receiveUsdValue.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            </div>

            {/* Details Card */}
            <div className="px-4 pt-3">
              <div
                className="flex flex-col rounded-[20px] px-4 py-3 gap-3"
                style={{ background: "#f2f2f7" }}
              >
                {/* Rate */}
                <div className="flex items-center justify-between">
                  <p
                    className="text-[15px] leading-5"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    Rate
                  </p>
                  <p className="text-[15px] leading-5 text-black">
                    {rateDisplay}
                  </p>
                </div>
                {/* Slippage */}
                <div className="flex items-center justify-between">
                  <p
                    className="text-[15px] leading-5"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    Slippage
                  </p>
                  <p className="text-[15px] leading-5 text-black">1%</p>
                </div>
                {/* Network Fee */}
                <div className="flex items-center justify-between">
                  <p
                    className="text-[15px] leading-5"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    Network Fee
                  </p>
                  <p className="text-[15px] leading-5 text-black">
                    0.00005 SOL ≈ $0.00
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* RESULT VIEW (swapping / success / error) */}
          <div
            className="absolute inset-0 flex flex-col transition-all duration-300 ease-out"
            style={{
              transform: `translateX(${view === "result" ? 0 : 100}%)`,
              opacity: view === "result" ? 1 : 0,
              pointerEvents: view === "result" ? "auto" : "none",
            }}
          >
            {activeTab === "swap" ? (
              /* SWAP RESULT */
              <>
                {isSwapping ? (
                  <div className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
                    <div className="flex items-center gap-2 mb-5">
                      <div className="w-[56px] h-[56px] rounded-full overflow-hidden bg-[#f2f2f7]">
                        <Image
                          src={fromToken.icon}
                          alt={getTokenIconAlt(fromToken)}
                          width={56}
                          height={56}
                        />
                      </div>
                      <ChevronRight
                        size={20}
                        strokeWidth={2}
                        style={{ color: "rgba(60, 60, 67, 0.3)" }}
                      />
                      <div className="w-[56px] h-[56px] rounded-full overflow-hidden bg-[#f2f2f7]">
                        <Image
                          src={toToken.icon}
                          alt={getTokenIconAlt(toToken)}
                          width={56}
                          height={56}
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 items-center text-center max-w-[280px]">
                      <h2 className="text-xl font-semibold text-black leading-6">
                        Swapping...
                      </h2>
                      <p
                        className="text-base leading-5"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        You can close this screen and continue using the app
                      </p>
                    </div>
                  </div>
                ) : swapError ? (
                  <div className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
                    <div className="relative mb-5">
                      <Image
                        src="/dogs/dog-cry.png"
                        alt="Error"
                        width={96}
                        height={96}
                      />
                    </div>
                    <div className="flex flex-col gap-2 items-center text-center max-w-[280px]">
                      <h2 className="text-xl font-semibold text-black leading-6">
                        Swap failed
                      </h2>
                      <p
                        className="text-base leading-5"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        {swapError}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
                    <div className="relative mb-5">
                      <Image
                        src="/dogs/dog-green.png"
                        alt="Success"
                        width={96}
                        height={96}
                      />
                    </div>
                    <div className="flex flex-col gap-2 items-center text-center max-w-[280px]">
                      <h2 className="text-xl font-semibold text-black leading-6">
                        Swap Completed
                      </h2>
                      <p
                        className="text-base leading-5"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        <span className="text-black">
                          {swappedToAmount?.toFixed(4).replace(/\.?0+$/, "") ||
                            "0"}{" "}
                          {swappedToSymbol || ""}
                        </span>{" "}
                        has been deposited to your wallet
                      </p>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* SECURE RESULT */
              <>
                {isSwapping ? (
                  <div className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
                    {/* Shield: token icon → Shield.svg | Unshield: Shield.svg → token icon */}
                    <div className="flex items-center gap-2 mb-5">
                      {secureDirection === "shield" ? (
                        <>
                          <div className="w-[56px] h-[56px] rounded-full overflow-hidden bg-[#f2f2f7]">
                            <Image
                              src={secureToken.icon}
                              alt={getTokenIconAlt(secureToken)}
                              width={56}
                              height={56}
                            />
                          </div>
                          <ChevronRight
                            size={20}
                            strokeWidth={2}
                            style={{ color: "rgba(60, 60, 67, 0.3)" }}
                          />
                          <div className="w-[56px] h-[56px] flex items-center justify-center">
                            <Image
                              src="/Shield.svg"
                              alt="Shield"
                              width={56}
                              height={56}
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="w-[56px] h-[56px] flex items-center justify-center">
                            <Image
                              src="/Shield.svg"
                              alt="Shield"
                              width={56}
                              height={56}
                            />
                          </div>
                          <ChevronRight
                            size={20}
                            strokeWidth={2}
                            style={{ color: "rgba(60, 60, 67, 0.3)" }}
                          />
                          <div className="w-[56px] h-[56px] rounded-full overflow-hidden bg-[#f2f2f7]">
                            <Image
                              src={secureToken.icon}
                              alt={getTokenIconAlt(secureToken)}
                              width={56}
                              height={56}
                            />
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 items-center text-center max-w-[280px]">
                      <h2 className="text-xl font-semibold text-black leading-6">
                        {secureDirection === "shield"
                          ? "Securing..."
                          : "Unshielding..."}
                      </h2>
                      <p
                        className="text-base leading-5"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        You can close this screen and continue using the app
                      </p>
                    </div>
                  </div>
                ) : swapError ? (
                  <div className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
                    <div className="relative mb-5">
                      <Image
                        src="/dogs/dog-cry.png"
                        alt="Error"
                        width={96}
                        height={96}
                      />
                    </div>
                    <div className="flex flex-col gap-2 items-center text-center max-w-[280px]">
                      <h2 className="text-xl font-semibold text-black leading-6">
                        {secureDirection === "shield"
                          ? "Securing failed"
                          : "Unshielding failed"}
                      </h2>
                      <p
                        className="text-base leading-5"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        {swapError}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
                    <div className="relative mb-5">
                      <Image
                        src="/dogs/dog-green.png"
                        alt="Success"
                        width={96}
                        height={96}
                      />
                    </div>
                    <div className="flex flex-col gap-2 items-center text-center max-w-[280px]">
                      <h2 className="text-xl font-semibold text-black leading-6">
                        {swappedToSymbol || secureToken.symbol}{" "}
                        {secureDirection === "shield"
                          ? "Secured"
                          : "Unshielded"}
                      </h2>
                      <p
                        className="text-base leading-5"
                        style={{ color: "rgba(60, 60, 67, 0.6)" }}
                      >
                        <span className="text-black">
                          {swappedToAmount?.toFixed(4).replace(/\.?0+$/, "") ||
                            "0"}{" "}
                          {swappedToSymbol || secureToken.symbol}
                        </span>{" "}
                        moved to your{" "}
                        {secureDirection === "shield"
                          ? "secure balance"
                          : "main balance"}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
