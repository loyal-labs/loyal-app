"use client";

import { hapticFeedback } from "@telegram-apps/sdk-react";
import { Search, X } from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useTelegramSafeArea } from "@/hooks/useTelegramSafeArea";
import { resolveTokenIcon } from "@/lib/solana/token-holdings";
import type { TokenHolding } from "@/lib/solana/token-holdings/types";
import { hideAllButtons } from "@/lib/telegram/mini-app/buttons";

export type TokensSheetProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  tokenHoldings: TokenHolding[];
};

// iOS-style sheet timing
const SHEET_TRANSITION = "transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)";
const OVERLAY_TRANSITION = "opacity 0.3s ease";

export default function TokensSheet({
  open,
  onOpenChange,
  tokenHoldings,
}: TokensSheetProps) {
  const formatEarnedLabel = (earnedBalance: number, symbol: string): string =>
    `Total Earned ${earnedBalance.toLocaleString("en-US", {
      maximumFractionDigits: 4,
    })} ${symbol}`;

  const { bottom: safeBottom } = useTelegramSafeArea();
  const [searchQuery, setSearchQuery] = useState("");
  const [mounted, setMounted] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [rendered, setRendered] = useState(false);
  const [show, setShow] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragDelta = useRef(0);
  const isDragging = useRef(false);
  const isClosing = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Open: mount elements, force a layout read to flush the initial
  // translateY(100%) style, then trigger the CSS transition
  useEffect(() => {
    if (open) {
      isClosing.current = false;
      setRendered(true);
    }
  }, [open]);

  useEffect(() => {
    if (rendered && open && !show && !isClosing.current) {
      // Force browser to acknowledge the initial off-screen position
      sheetRef.current?.getBoundingClientRect();
      setShow(true);
    }
  }, [rendered, open, show]);

  // Measure actual header element height to position sheet below it
  useEffect(() => {
    if (!open) return;
    const header = document.querySelector("header");
    if (header) {
      setHeaderHeight(header.getBoundingClientRect().bottom);
    }
  }, [open]);

  const filteredTokens = useMemo(() => {
    if (!searchQuery.trim()) return tokenHoldings;
    const q = searchQuery.toLowerCase();
    return tokenHoldings.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q),
    );
  }, [tokenHoldings, searchQuery]);

  const unmount = useCallback(() => {
    setRendered(false);
    setShow(false);
    setSearchQuery("");
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

    // Animate out with CSS transitions
    if (sheetRef.current) {
      sheetRef.current.style.transition = SHEET_TRANSITION;
      sheetRef.current.style.transform = "translateY(100%)";
    }
    if (overlayRef.current) {
      overlayRef.current.style.transition = OVERLAY_TRANSITION;
      overlayRef.current.style.opacity = "0";
    }
  }, []);

  // After close transition ends, unmount
  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
      if (e.propertyName === "transform" && isClosing.current) {
        unmount();
      }
    },
    [unmount],
  );

  // Pull-down-to-close touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    isDragging.current = true;
    dragStartY.current = e.touches[0].clientY;
    dragDelta.current = 0;
    // Disable CSS transition during drag for direct control
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
      // Close — re-enable transition and slide off
      closeSheet();
    } else {
      // Spring back
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

  // Lock body scroll when rendered
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
        {/* Handle bar — pull down to close */}
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

        {/* Header — also draggable */}
        <div
          className="relative h-[44px] flex items-center justify-center shrink-0 px-4"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <span className="text-[17px] font-semibold text-black leading-[22px]">
            Tokens
          </span>

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
              ref={inputRef}
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent py-3 text-[17px] leading-[22px] text-black placeholder:text-[rgba(60,60,67,0.6)] outline-none"
            />
          </div>
        </div>

        {/* Token List - scrollable */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain"
          style={{ paddingBottom: Math.max(safeBottom, 24) + 80 }}
        >
          {filteredTokens.map((token) => {
            const iconSrc = resolveTokenIcon(token);

            return (
              <div
                key={token.mint}
                className="flex items-center px-4"
              >
                <div className="py-1.5 pr-3">
                  <div className="w-12 h-12 relative">
                    <div className="w-12 h-12 rounded-full overflow-hidden relative bg-[#f2f2f7]">
                      <Image
                        src={iconSrc}
                        alt={token.symbol}
                        fill
                        className="object-contain"
                      />
                    </div>
                    {token.isSecured && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-[20px] h-[20px]">
                        <Image src="/Shield.svg" alt="Secured" width={20} height={20} />
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex-1 flex flex-col py-2.5 min-w-0">
                  <p className="text-[17px] font-medium text-black leading-[22px] tracking-[-0.187px]">
                    {token.symbol}
                  </p>
                  <p
                    className="text-[15px] leading-5"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    {typeof token.earnedBalance === "number"
                      ? formatEarnedLabel(token.earnedBalance, token.symbol)
                      : token.priceUsd !== null
                      ? `$${token.priceUsd.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      : "—"}
                  </p>
                </div>
                <div className="flex flex-col items-end py-2.5 pl-3">
                  <p className="text-[17px] text-black leading-[22px] text-right">
                    {token.balance.toLocaleString("en-US", {
                      maximumFractionDigits: 4,
                    })}
                  </p>
                  <p
                    className="text-[15px] leading-5 text-right"
                    style={{ color: "rgba(60, 60, 67, 0.6)" }}
                  >
                    {token.valueUsd !== null
                      ? `$${token.valueUsd.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`
                      : "—"}
                  </p>
                </div>
              </div>
            );
          })}

          {filteredTokens.length === 0 && searchQuery.trim() && (
            <div className="flex items-center justify-center py-12">
              <p
                className="text-[17px] leading-[22px]"
                style={{ color: "rgba(60, 60, 67, 0.6)" }}
              >
                No tokens found
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
