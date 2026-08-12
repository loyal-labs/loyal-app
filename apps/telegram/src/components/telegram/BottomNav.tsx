"use client";

import { hapticFeedback } from "@telegram-apps/sdk-react";
import {
  MessageCircleMore,
  User,
  Wallet
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number; style?: React.CSSProperties }>;
};

const navItems: NavItem[] = [
  { href: "/telegram/summaries", icon: MessageCircleMore },
  { href: "/telegram/wallet", icon: Wallet },
  { href: "/telegram/profile", icon: User }
];

export default function BottomNav() {
  const pathname = usePathname();

  // Hide nav on certain pages (e.g., feed page, direct chat page)
  const hiddenPaths = ["/telegram/summaries/feed", "/telegram/summaries/direct", "/telegram/verify"];
  const shouldHide = hiddenPaths.some(path => pathname?.startsWith(path));

  const handleNavClick = () => {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred("light");
    }
  };

  if (shouldHide) {
    return null;
  }

  // Find active index
  const activeIndex = navItems.findIndex(
    item =>
      pathname === item.href ||
      (item.href === "/telegram/wallet" && pathname === "/telegram")
  );

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50">
      <div
        className="mx-auto max-w-md px-4 pb-2"
        style={{
          paddingBottom: "calc(max(8px, var(--tg-content-safe-area-inset-bottom, 0px)) + 16px)"
        }}
      >
        <div
          className="relative flex items-center p-1 rounded-full overflow-hidden"
          style={{
            background: "rgba(128, 128, 128, 0.1)",
            backdropFilter: "blur(22px)"
          }}
        >
          {/* Sliding indicator */}
          <div
            className="absolute top-1 bottom-1 rounded-full transition-transform duration-300 ease-out"
            style={{
              width: `calc((100% - 8px) / ${navItems.length})`,
              transform: `translateX(calc(${activeIndex} * 100%))`,
              background: "rgba(0, 0, 0, 0.06)"
            }}
          />

          {navItems.map(item => {
            const isActive =
              pathname === item.href ||
              (item.href === "/telegram/wallet" && pathname === "/telegram");
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={handleNavClick}
                className="relative z-10 flex-1 flex items-center justify-center py-3 rounded-full active:bg-white/[0.04] transition-colors duration-150"
              >
                <Icon
                  className="w-7 h-7 transition-colors duration-300"
                  style={{ color: isActive ? "#3C3C43" : "rgba(60, 60, 67, 0.4)" }}
                  strokeWidth={1.5}
                />
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
