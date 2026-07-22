"use client";

import { useEffect, useState } from "react";

import { sanitizeBucksAmountInput } from "@/components/wallet-sidebar/earn-detail-view";
import {
  hiddenBalanceStyle,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import type { EarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import { useStablecoinsUsd } from "@/components/wallet-workspace/facelift/use-stablecoins-usd";
import { splitUsdBalance } from "@/hooks/use-wallet-desktop-data";

const ASSET_BASE = "/wallet-workspace/facelift";

function parseAmountUsd(value: string) {
  return Number.parseFloat(value.replace(/,/g, "")) || 0;
}

function InfoContent() {
  return (
    <div className="flex min-h-0 w-full flex-1 items-center justify-center p-2">
      {/* ponytail: the design's info panel is still a placeholder — swap in
          real copy when it lands in Figma. */}
      <p className="text-center text-[16px] leading-5 text-[#8a8a8e]">Content</p>
    </div>
  );
}

// "How Autodeposit works" as an overlay: card next to the sidebar below
// 1204px (Figma 4693:69792), bottom sheet on mobile (Figma 4693:71793).
// Also reachable from the Earn screen's mobile "?" (Figma 4693:70364).
export function AutodepositInfoOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/20 p-2 pl-[368px] backdrop-blur-[4px] min-[1204px]:hidden max-[795px]:bg-white/60 max-[795px]:p-0 max-[795px]:pt-8"
      onClick={onClose}
    >
      <div
        aria-modal="true"
        className="flex h-full w-full min-w-0 flex-col overflow-clip rounded-3xl bg-white max-[795px]:rounded-b-none max-[795px]:shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="flex w-full items-center p-2">
          <h2 className="min-w-0 flex-1 truncate py-2.5 pl-4 font-semibold text-[20px] text-black leading-6">
            How Autodeposit works
          </h2>
          <button
            aria-label="Close info"
            className="flex size-11 shrink-0 items-center justify-center rounded-3xl"
            onClick={onClose}
            type="button"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              aria-hidden="true"
              className="size-6"
              src={`${ASSET_BASE}/icon-cross.svg`}
            />
          </button>
        </header>
        <InfoContent />
        <div className="w-full px-4 pt-2 pb-4 min-[796px]:hidden">
          <button
            className="flex h-12 w-full items-center justify-center rounded-full bg-[#f5f5f5] font-medium text-[16px] text-black leading-5"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Figma 4693:69332 (create, wide) / 4693:75306 (edit: Delete + Confirm) /
// 4693:75556 (edit, unchanged: "No changes yet") / 4693:69662+69792 (narrow:
// ? in the header opens the info panel as an overlay). Create/Confirm/Delete
// actions are not wired yet — display-only per the screen-by-screen plan.
export function AutodepositPane({
  data,
  onBack,
}: {
  data: EarnPositionData;
  onBack: () => void;
}) {
  const autodeposit = data.autodepositConfig;
  const isEdit = Boolean(autodeposit);
  const initialAmount = autodeposit
    ? sanitizeBucksAmountInput(
        autodeposit.keepAmount.replace(/\.00$/, ""),
        ""
      ) ?? ""
    : "";
  const [amount, setAmount] = useState(initialAmount);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const { isBalanceHidden } = useBalanceVisibility();

  const stablecoinsUsd = useStablecoinsUsd();
  const stablecoinsBalance = splitUsdBalance(stablecoinsUsd);
  const earnBalance = splitUsdBalance(data.earnBalanceUsd);
  const addressLabel = data.walletAddress
    ? `${data.walletAddress.slice(0, 4)}…${data.walletAddress.slice(-4)}`
    : "";

  const hasChanges =
    !isEdit ||
    parseAmountUsd(amount) !== parseAmountUsd(autodeposit?.keepAmount ?? "0");

  const handleAmountChange = (rawValue: string) => {
    const sanitized = sanitizeBucksAmountInput(rawValue, amount);
    if (sanitized !== null) {
      setAmount(sanitized);
    }
  };

  return (
    <>
      <section className="flex h-full min-w-0 flex-1 flex-col overflow-clip rounded-3xl bg-white max-[795px]:rounded-none">
        <header className="flex w-full items-center p-2">
          <div className="pr-3">
            <button
              aria-label="Back"
              className="flex size-11 items-center justify-center rounded-3xl hover:bg-black/[0.04]"
              onClick={onBack}
              type="button"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                aria-hidden="true"
                className="size-6"
                src={`${ASSET_BASE}/icon-arrow-left.svg`}
              />
            </button>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 py-2">
            <h1 className="truncate font-semibold text-[20px] text-black leading-6">
              Autodeposit
            </h1>
            <button
              aria-label="How Autodeposit works"
              className="flex size-6 shrink-0 items-center justify-center min-[1204px]:hidden"
              onClick={() => setIsInfoOpen(true)}
              type="button"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                aria-hidden="true"
                className="size-6"
                src={`${ASSET_BASE}/icon-question.svg`}
              />
            </button>
          </div>
          {isEdit ? (
            <div className="flex items-start pl-3">
              {/* ponytail: delete action not wired yet — button is a no-op */}
              <button
                className="flex items-center justify-center gap-2 rounded-full bg-[rgba(249,54,60,0.08)] p-2.5"
                type="button"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-6"
                  src={`${ASSET_BASE}/icon-trash-red.svg`}
                />
                <span className="whitespace-nowrap pr-2.5 font-medium text-[#f9363c] text-[16px] leading-5">
                  Delete
                </span>
              </button>
            </div>
          ) : null}
        </header>

        <div className="flex min-h-0 w-full flex-1 flex-col">
          <div className="flex w-full flex-1 flex-col">
            <div className="w-full p-2">
              <label className="flex w-full flex-col gap-0.5 rounded-2xl px-4 py-2">
                <span className="whitespace-nowrap text-[16px] leading-5 text-[rgba(60,60,67,0.6)]">
                  Deposit anything above
                </span>
                <span className="flex h-12 w-full items-baseline">
                  <span className="font-semibold text-[40px] text-black leading-[48px]">
                    $
                  </span>
                  <input
                    autoFocus
                    className="min-w-0 flex-1 border-none bg-transparent font-semibold text-[40px] text-black leading-[48px] outline-none placeholder:text-[#b1b1b4]"
                    inputMode="decimal"
                    onChange={(event) => handleAmountChange(event.target.value)}
                    placeholder="0"
                    type="text"
                    value={amount}
                  />
                </span>
              </label>
            </div>

            <div className="w-full px-2">
              <div className="flex w-full items-start px-4">
                <div className="flex items-center py-1 pr-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    aria-hidden="true"
                    className="size-6"
                    src={`${ASSET_BASE}/icon-exclamation-circle.svg`}
                  />
                </div>
                <p className="min-w-0 max-w-[400px] flex-1 py-2 text-[#f9363c] text-[13px] leading-4">
                  Any stablecoins above this amount will automatically go to
                  Earn
                </p>
              </div>
            </div>
          </div>

          <div className="relative flex h-36 w-full flex-col gap-1 overflow-clip p-2">
            <div className="flex w-full items-center rounded-2xl px-4">
              <div className="py-2 pr-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-11"
                  src={`${ASSET_BASE}/stablecoins-icon.svg`}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 py-2">
                <span className="truncate text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
                  {`from Stablecoins · ${addressLabel}`}
                </span>
                <p
                  className="whitespace-nowrap font-semibold text-[20px] text-black leading-6"
                  style={hiddenBalanceStyle(isBalanceHidden)}
                >
                  {stablecoinsBalance.balanceWhole}
                  <span className="text-[rgba(60,60,67,0.4)]">
                    {stablecoinsBalance.balanceFraction}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex w-full items-center rounded-2xl px-4">
              <div className="py-2 pr-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-11"
                  src={`${ASSET_BASE}/earn-icon.svg`}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 py-2">
                <span className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
                  to Earn
                </span>
                <p
                  className="whitespace-nowrap font-semibold text-[20px] text-black leading-6"
                  style={hiddenBalanceStyle(isBalanceHidden)}
                >
                  {earnBalance.balanceWhole}
                  <span className="text-[rgba(60,60,67,0.4)]">
                    {earnBalance.balanceFraction}
                  </span>
                </p>
              </div>
            </div>

            <div className="-translate-y-1/2 absolute top-[calc(50%-2px)] left-[45px] h-3.5 w-0.5 rounded-xl bg-[#d9d9d9]" />
          </div>
        </div>

        <div className="w-full bg-white px-4 pt-2 pb-4">
          {hasChanges ? (
            // ponytail: create/update transaction not wired yet — no-op
            <button
              className="flex h-12 w-full items-center justify-center rounded-full bg-black font-medium text-[16px] text-white leading-5"
              type="button"
            >
              {isEdit ? "Confirm" : "Create Autodeposit"}
            </button>
          ) : (
            <div className="flex h-12 w-full items-center justify-center rounded-full bg-black/[0.04] font-medium text-[16px] leading-5 text-[rgba(60,60,67,0.6)]">
              No changes yet
            </div>
          )}
        </div>
      </section>

      {/* Info panel: fixed right pane on wide viewports (Figma 4693:69387),
          overlay via the header ? below 1204px (Figma 4693:69792). */}
      <aside className="hidden h-full w-[400px] shrink-0 flex-col overflow-clip rounded-3xl bg-white min-[1204px]:flex">
        <header className="flex w-full items-center p-2">
          <h2 className="min-w-0 flex-1 truncate py-2.5 pl-4 font-semibold text-[20px] text-black leading-6">
            How Autodeposit works
          </h2>
        </header>
        <InfoContent />
      </aside>

      {isInfoOpen ? (
        <AutodepositInfoOverlay onClose={() => setIsInfoOpen(false)} />
      ) : null}
    </>
  );
}
