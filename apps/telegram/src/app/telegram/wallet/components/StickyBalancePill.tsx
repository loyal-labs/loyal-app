"use client";

import { hapticFeedback } from "@telegram-apps/sdk-react";
import { useCallback, useEffect, useState } from "react";

interface StickyBalancePillProps {
  safeAreaInsetTop: number;
  displayCurrency: "USD" | "SOL";
  usdBalance: number;
  solBalance: number;
  visible: boolean;
  balanceRef: React.RefObject<HTMLDivElement | null>;
}

export function StickyBalancePill({
  safeAreaInsetTop,
  displayCurrency,
  usdBalance,
  solBalance,
  visible,
  balanceRef,
}: StickyBalancePillProps) {
  const [stickyBalanceOpacity, setStickyBalanceOpacity] = useState(0);

  // Track balance card position for sticky pill crossfade with header logo.
  // Crossfade starts as the card bottom approaches the header — i.e. when
  // the card is almost fully scrolled behind the header, not when its top
  // edge first touches it.
  useEffect(() => {
    const headerBottom = Math.max(safeAreaInsetTop || 0, 12) + 10 + 27 + 16;
    const fadeRange = 50; // px over which the crossfade happens

    const handleScroll = () => {
      const el = balanceRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Progress 0→1 as the card bottom moves from (headerBottom + fadeRange) to headerBottom
      const progress =
        rect.bottom >= headerBottom + fadeRange
          ? 0
          : rect.bottom <= headerBottom
            ? 1
            : 1 - (rect.bottom - headerBottom) / fadeRange;
      setStickyBalanceOpacity(progress);
      document.documentElement.style.setProperty(
        "--header-logo-opacity",
        String(1 - progress),
      );
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => {
      window.removeEventListener("scroll", handleScroll);
      document.documentElement.style.removeProperty("--header-logo-opacity");
    };
  }, [safeAreaInsetTop, balanceRef]);

  const handleScrollToTop = useCallback(() => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={handleScrollToTop}
      className="fixed left-1/2 -translate-x-1/2 z-[51] flex items-center px-4 py-1.5 rounded-[54px] active:opacity-80"
      style={{
        top: `${Math.max(safeAreaInsetTop || 0, 12) + 4}px`,
        background: "#fff",
        opacity: stickyBalanceOpacity,
        pointerEvents: stickyBalanceOpacity > 0.1 ? "auto" : "none",
        willChange: "opacity",
      }}
    >
      <span
        className="text-sm font-medium text-black"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {displayCurrency === "USD"
          ? `$${usdBalance.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`
          : `${solBalance.toLocaleString("en-US", {
              minimumFractionDigits: 4,
              maximumFractionDigits: 4,
            })} SOL`}
      </span>
    </button>
  );
}
