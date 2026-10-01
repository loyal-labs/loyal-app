"use client";

import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";

const ASSET_BASE = "/wallet-workspace/facelift";

// Figma 5465:83296 — mobile-only bottom tab bar: bone (future quests,
// inactive) · mascot pill (the wallet home) · Activity. Earn and Earn MAX are
// subscreens behind the home's product cards, not tabs. Input screens
// (deposit/withdraw/autodeposit, send/swap) hide the bar under the keyboard.
export function MobileTabBar({
  activeTab,
  onSelect,
  showActivityBadge = false,
}: {
  activeTab: "activity" | "wallet";
  onSelect: (tab: "activity" | "wallet") => void;
  showActivityBadge?: boolean;
}) {
  return (
    <div className="cherry-mobile-tab-bar w-full shrink-0 bg-card px-4 min-[796px]:hidden">
      <div className="flex w-full items-center gap-4">
        {/* Future quests slot — decorative until the feature ships. */}
        <div
          aria-hidden="true"
          className="flex flex-1 flex-col items-center justify-center py-4 opacity-40"
        >
          <ThemedIcon
            className="size-7 text-tertiary"
            src={`${ASSET_BASE}/icon-bone.svg`}
          />
        </div>
        <button
          aria-current={activeTab === "wallet" ? "page" : undefined}
          aria-label="Wallet"
          className="flex-1 py-2"
          onClick={() => onSelect("wallet")}
          type="button"
        >
          {/* The mascot pill IS the wallet: dark when the home is open
              (Figma 5465:83302), light-red tint elsewhere. */}
          <span
            className={`relative mx-auto block h-11 w-full max-w-16 overflow-hidden rounded-full ${
              activeTab === "wallet" ? "bg-foreground" : "bg-primary/[0.14]"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              aria-hidden="true"
              className="-translate-x-1/2 absolute bottom-0 left-[calc(50%+4px)] h-9 w-11 max-w-none"
              src={`${ASSET_BASE}/tab-mascot.svg`}
            />
          </span>
        </button>
        <button
          aria-current={activeTab === "activity" ? "page" : undefined}
          aria-label="Activity"
          className="flex flex-1 flex-col items-center justify-center py-4"
          onClick={() => onSelect("activity")}
          type="button"
        >
          <span className="relative">
            <ThemedIcon
              className={`size-7 ${
                activeTab === "activity" ? "text-foreground" : "text-tertiary"
              }`}
              src={`${ASSET_BASE}/${
                activeTab === "activity"
                  ? "icon-tab-clock-black.svg"
                  : "icon-clock-history.svg"
              }`}
            />
            {/* Same unseen-activity badge the sidebar clock shows. */}
            <span
              className="t-badge t-badge-tab"
              data-open={showActivityBadge ? "true" : "false"}
            >
              <span className="t-badge-dot size-1.5 rounded-full bg-primary" />
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
