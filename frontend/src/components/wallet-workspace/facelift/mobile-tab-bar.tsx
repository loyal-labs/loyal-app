"use client";

const ASSET_BASE = "/wallet-workspace/facelift";

// Figma 4693:69993 — mobile-only bottom tab bar: wallet · Earn (mascot pill,
// the active tab) · settings. Shown only on the root Earn views; input screens
// (deposit/withdraw/autodeposit) hide it under the system keyboard.
export function MobileTabBar() {
  return (
    <div className="w-full shrink-0 bg-white px-4 min-[796px]:hidden">
      <div className="flex w-full items-center gap-4">
        {/* ponytail: wallet/settings destinations are not wired yet — no-ops */}
        <button
          aria-label="Wallet"
          className="flex flex-1 flex-col items-center justify-center py-4"
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
        <div className="flex-1 py-2">
          <div className="relative h-11 w-full overflow-hidden rounded-full bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              aria-hidden="true"
              className="-translate-x-1/2 absolute bottom-0 left-[calc(50%+4px)] h-9 w-11 max-w-none"
              src={`${ASSET_BASE}/tab-mascot.svg`}
            />
          </div>
        </div>
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
