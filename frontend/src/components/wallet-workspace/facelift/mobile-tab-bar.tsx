"use client";

const ASSET_BASE = "/wallet-workspace/facelift";

// Figma 4813:400091 — mobile-only bottom tab bar: Wallet home · Earn (mascot
// pill) · Activity. Active icons go black, inactive stay #B1B1B4. Shown only
// on the root views; input screens (deposit/withdraw/autodeposit, send/swap)
// hide it under the system keyboard.
export function MobileTabBar({
  activeTab,
  onSelect,
}: {
  activeTab: "activity" | "earn" | "wallet";
  onSelect: (tab: "activity" | "earn" | "wallet") => void;
}) {
  return (
    <div className="w-full shrink-0 bg-white px-4 min-[796px]:hidden">
      <div className="flex w-full items-center gap-4">
        <button
          aria-current={activeTab === "wallet" ? "page" : undefined}
          aria-label="Wallet"
          className="flex flex-1 flex-col items-center justify-center py-4"
          onClick={() => onSelect("wallet")}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-7"
            src={`${ASSET_BASE}/${
              activeTab === "wallet"
                ? "icon-tab-wallet-black.svg"
                : "icon-tab-wallet.svg"
            }`}
          />
        </button>
        <button
          aria-current={activeTab === "earn" ? "page" : undefined}
          aria-label="Earn"
          className="flex-1 py-2"
          onClick={() => onSelect("earn")}
          type="button"
        >
          {/* Active Earn = the dark pill (Figma 4693:72074); inactive = the
              light-red tint (4813:400091). */}
          <span
            className={`relative mx-auto block h-11 w-full max-w-16 overflow-hidden rounded-full ${
              activeTab === "earn" ? "bg-black" : "bg-[rgba(249,54,60,0.14)]"
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-7"
            src={`${ASSET_BASE}/${
              activeTab === "activity"
                ? "icon-tab-clock-black.svg"
                : "icon-clock-history.svg"
            }`}
          />
        </button>
      </div>
    </div>
  );
}
