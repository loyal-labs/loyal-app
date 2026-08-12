"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { useDeviceSafeAreaTop } from "@/hooks/useTelegramSafeArea";

/**
 * Whether the status bar gray strip workaround is needed.
 * Only on Android — Telegram ignores setHeaderColor for status bar icon
 * contrast, so light icons are invisible on white bg.
 */
const isAndroid = () =>
  typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

export default function Header() {
  const safeAreaInsetTop = useDeviceSafeAreaTop();
  const [isScrolled, setIsScrolled] = useState(false);
  const [showStatusBarFix, setShowStatusBarFix] = useState(false);

  useEffect(() => {
    setShowStatusBarFix(isAndroid());
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex flex-col items-center justify-center"
      style={{
        paddingTop: Math.max(safeAreaInsetTop || 0, 12) + 10,
        paddingBottom: 16,
        background: "#fff",
        border: "none",
        boxShadow: "none",
      }}
    >
      {/* Light gray strip behind the Android status bar so light icons stay visible */}
      {showStatusBarFix && safeAreaInsetTop > 0 && (
        <div
          className="absolute top-0 left-0 right-0"
          style={{ height: safeAreaInsetTop, background: "#b0b0b0" }}
        />
      )}
      <Image
        src="/Logo.svg"
        alt="Loyal"
        width={98}
        height={29}
        priority
        style={{
          marginTop: -4,
          opacity: "var(--header-logo-opacity, 1)",
          willChange: "opacity",
        }}
      />
      {/* Bottom border line - only visible when scrolled */}
      <div
        className="absolute left-0 right-0 bottom-0 pointer-events-none transition-opacity duration-150"
        style={{
          height: 1,
          background: "rgba(0, 0, 0, 0.08)",
          opacity: isScrolled ? 1 : 0,
        }}
      />
    </header>
  );
}
