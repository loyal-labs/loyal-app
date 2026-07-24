"use client";

const ASSET_BASE = "/wallet-workspace/facelift";

// Figma 4693:69993 — mobile-only bottom tab bar: wallet (the Crypto screen) ·
// Earn (mascot pill) · settings. Shown only on the root views; input screens
// (deposit/withdraw/autodeposit, send/swap) hide it under the system keyboard.
export function MobileTabBar({
  activeTab,
  onSelectEarn,
  onSelectWallet,
}: {
  activeTab: "earn" | "wallet";
  onSelectEarn: () => void;
  onSelectWallet: () => void;
}) {
  return (
    <div className="w-full shrink-0 bg-white px-4 min-[796px]:hidden">
      <div className="flex w-full items-center gap-4">
        {/* ponytail: settings destination is not wired yet — no-op */}
        <button
          aria-current={activeTab === "wallet" ? "page" : undefined}
          aria-label="Wallet"
          className="flex flex-1 flex-col items-center justify-center py-4"
          onClick={onSelectWallet}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-7"
            src={`${ASSET_BASE}/icon-tab-wallet.svg`}
          />
        </button>
        <button
          aria-current={activeTab === "earn" ? "page" : undefined}
          aria-label="Earn"
          className="flex-1 py-2"
          onClick={onSelectEarn}
          type="button"
        >
          <span className="relative block h-11 w-full overflow-hidden rounded-full bg-black">
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
          aria-label="Settings"
          className="flex flex-1 flex-col items-center justify-center py-4"
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-7"
            src={`${ASSET_BASE}/icon-tab-gear.svg`}
          />
        </button>
      </div>
    </div>
  );
}
