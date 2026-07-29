"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  deriveEarnWithdrawMode,
  sanitizeBucksAmountInput,
  type EarnWithdrawDraft,
  type EarnWithdrawSourceOption,
} from "@/components/wallet-sidebar/earn-detail-view";
import {
  maskBalanceText,
  ScrambleText,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { DropdownReveal } from "@/components/wallet-workspace/facelift/dropdown-reveal";
import { DualIcon } from "@/components/wallet-workspace/facelift/earn-activity-card";
import { SheetReveal } from "@/components/wallet-workspace/facelift/sheet-reveal";
import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import type { EarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import { useStablecoinsUsd } from "@/components/wallet-workspace/facelift/use-stablecoins-usd";
import { splitUsdBalance } from "@/hooks/use-wallet-desktop-data";
import { resolveEarnTransactionMarketIcon } from "@/lib/yield-optimization/earn-position-display";

const ASSET_BASE = "/wallet-workspace/facelift";

// Display label matching the facelift rows: "Main Kamino USDC" for reserves
// (the OG source label is "<market> reserve"), the OG label for idle vaults.
function sourceDisplayLabel(source: EarnWithdrawSourceOption) {
  return source.type === "reserve"
    ? `${source.label.replace(/ reserve$/, "")} USDC`
    : source.label;
}

type WithdrawSourceOption = {
  icon: ReactNode;
  key: string;
  label: string;
  source: EarnWithdrawSourceOption | null;
  usd: number;
};

function SourceOptionRow({
  isSelected,
  onSelect,
  option,
  rounded,
}: {
  isSelected: boolean;
  onSelect: () => void;
  option: WithdrawSourceOption;
  rounded: string;
}) {
  const amount = splitUsdBalance(option.usd);
  const { isBalanceHidden } = useBalanceVisibility();
  return (
    <button
      className={`t-hover flex w-full items-center px-4 text-left hover:bg-black/[0.04] ${rounded}`}
      onClick={onSelect}
      type="button"
    >
      <span className="flex items-center py-2 pr-3">{option.icon}</span>
      <span className="flex h-[60px] min-w-0 flex-1 flex-col gap-0.5 py-[9px]">
        <span className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
          {option.label}
        </span>
        <span className="whitespace-nowrap font-semibold text-[20px] text-black leading-6">
          <ScrambleText isHidden={isBalanceHidden} text={amount.balanceWhole} />
          <span className="text-[rgba(60,60,67,0.4)]">
            <ScrambleText
              isHidden={isBalanceHidden}
              text={amount.balanceFraction}
            />
          </span>
        </span>
      </span>
      {isSelected ? (
        <span className="flex items-center justify-end pl-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-6"
            src={`${ASSET_BASE}/icon-check-red.svg`}
          />
        </span>
      ) : null}
    </button>
  );
}

// Figma 4693:66727 (positions pane, empty amount) + 4693:66028 (valid amount)
// + 4693:66297 (narrow: source select becomes a dropdown action-sheet).
// Renders the middle Withdraw card and, on wide viewports, the Positions
// selector card in place of the chart pane. Withdrawals run through
// data.actions (OG protocol); after a full exit the pane flips into the
// rent-cleanup phase ("Close policies").
export function WithdrawPane({
  data,
  initialSourceKey,
  onBack,
}: {
  data: EarnPositionData;
  initialSourceKey?: string | null;
  onBack: () => void;
}) {
  const [amount, setAmount] = useState("");
  // Preselects the positions-row source that opened the screen; otherwise
  // defaults to the first eligible source (options[0] fallback below).
  const [selectedKey, setSelectedKey] = useState(initialSourceKey ?? "");
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const { isBalanceHidden } = useBalanceVisibility();

  const stablecoinsUsd = useStablecoinsUsd();
  const stablecoinsBalance = splitUsdBalance(stablecoinsUsd);
  const addressLabel = data.walletAddress
    ? `${data.walletAddress.slice(0, 4)}…${data.walletAddress.slice(-4)}`
    : "";

  // OG-eligible sources (kamino-only when any kamino holding exists), built
  // by the same helper the old workspace's withdraw view uses.
  const sources = data.actions.withdrawSources;
  const options = useMemo<WithdrawSourceOption[]>(
    () =>
      sources.map((source) => ({
        icon: (
          <DualIcon
            frontSrc={resolveEarnTransactionMarketIcon({
              market: source.market,
            })}
          />
        ),
        key: source.id,
        label: sourceDisplayLabel(source),
        source,
        usd: source.balance,
      })),
    [sources]
  );
  // Null while no sources exist (cleanup-only phase after a full exit).
  const selectedOption =
    options.find((option) => option.key === selectedKey) ?? options[0] ?? null;
  const fromBalance = splitUsdBalance(selectedOption?.usd ?? 0);

  const amountUsd = Number.parseFloat(amount.replace(/,/g, "")) || 0;
  // Same mode derivation as the old workspace: compared against the floored
  // TOTAL of all sources, so the visible max registers as a full exit.
  const withdrawMode = deriveEarnWithdrawMode({ amount: amountUsd, sources });
  const fullExitSources = useMemo(
    () => sources.filter((source) => source.type === "reserve"),
    [sources]
  );
  // A picked row maps 1:1 to its source, same as the OG picker.
  const draftSource = selectedOption?.source ?? null;
  const withdrawValidationError =
    sources.length === 0
      ? "No withdrawable Earn source"
      : !Number.isFinite(amountUsd) || amountUsd <= 0
      ? "Enter amount"
      : amountUsd > (selectedOption?.usd ?? 0) || !draftSource
      ? "Insufficient balance"
      : null;
  const canWithdraw = withdrawValidationError === null;
  const isSubmitting = data.actions.isWithdrawPending;
  const isCleanupOnly =
    data.actions.hasCleanupCandidate && sources.length === 0;

  const handleAmountChange = (rawValue: string) => {
    const sanitized = sanitizeBucksAmountInput(rawValue, amount);
    if (sanitized !== null) {
      setAmount(sanitized);
    }
  };
  const selectSource = (key: string) => {
    setSelectedKey(key);
    setIsSheetOpen(false);
  };
  const handleSubmit = async () => {
    if (!draftSource) {
      return;
    }
    const draft: EarnWithdrawDraft = {
      amount: amountUsd,
      amountLabel: amount,
      destination: data.actions.depositSource,
      fullExitSources,
      mode: withdrawMode,
      source: draftSource,
      symbol: "USDC",
      tokenDecimals: 6,
    };
    const didWithdraw = await data.actions.submitWithdraw(draft);
    if (didWithdraw && draft.mode === "partial") {
      onBack();
    }
    // A full exit stays here: the pane flips into cleanup-only mode so the
    // rent-refund phase ("Close policies") is one click away, like the OG's
    // re-opened withdraw view.
  };
  const handleCleanup = async () => {
    const didCleanup = await data.actions.runCleanup();
    if (didCleanup) {
      onBack();
    }
  };

  useEffect(() => {
    if (!isSheetOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsSheetOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSheetOpen]);

  return (
    <>
      <section className="flex h-full min-w-0 flex-1 flex-col overflow-clip rounded-3xl bg-white max-[795px]:rounded-none">
        <header className="flex w-full items-center p-2">
          <div className="pr-3">
            <button
              aria-label="Back"
              className="t-hover flex size-11 items-center justify-center rounded-3xl hover:bg-black/[0.04]"
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
          <h1 className="min-w-0 flex-1 truncate py-2 font-semibold text-[20px] text-black leading-6">
            Withdraw
          </h1>
        </header>

        <div className="flex min-h-0 w-full flex-1 flex-col">
          <div className="flex w-full flex-1 flex-col">
            <div className="w-full p-2">
              <label className="flex w-full flex-col gap-0.5 rounded-2xl px-4 py-2">
                <span className="whitespace-nowrap text-[16px] leading-5 text-[rgba(60,60,67,0.6)]">
                  Amount
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
          </div>

          <div className="relative flex h-36 w-full flex-col gap-1 p-2">
            {isSheetOpen ? (
              <button
                aria-label="Close position select"
                className="fixed inset-0 z-10 cursor-default min-[1204px]:hidden max-[795px]:hidden"
                onClick={() => setIsSheetOpen(false)}
                type="button"
              />
            ) : null}
            <DropdownReveal
              className="absolute inset-x-2 bottom-full z-20 flex flex-col rounded-2xl bg-white/70 p-2 shadow-[0px_0px_2px_0px_rgba(0,0,0,0.08),0px_4px_16px_0px_rgba(0,0,0,0.08)] backdrop-blur-[16px] min-[1204px]:hidden max-[795px]:hidden"
              isOpen={isSheetOpen}
              origin="bottom-center"
            >
              {options.map((option) => (
                <SourceOptionRow
                  isSelected={option.key === selectedOption?.key}
                  key={option.key}
                  onSelect={() => selectSource(option.key)}
                  option={option}
                  rounded="rounded-lg"
                />
              ))}
            </DropdownReveal>
            {/* Mobile: the source select is a bottom sheet instead of the
                anchored dropdown (Figma 4693:71494); it rises on the
                panel-reveal clock like a native sheet. */}
            <SheetReveal
              isOpen={isSheetOpen}
              onClose={() => setIsSheetOpen(false)}
              scrimClassName="fixed inset-0 z-50 hidden flex-col justify-end bg-white/60 pt-8 backdrop-blur-[4px] max-[795px]:flex"
              sheetClassName="flex w-full flex-col rounded-t-3xl bg-white shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
            >
              <header className="flex w-full items-center p-2">
                <h2 className="min-w-0 flex-1 truncate py-2.5 pl-2 font-semibold text-[20px] text-black leading-6">
                  Positions
                </h2>
                <button
                  aria-label="Close position select"
                  className="t-hover flex size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-black/[0.04]"
                  onClick={() => setIsSheetOpen(false)}
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
              <div className="flex w-full flex-col py-2">
                {options.map((option) => (
                  <SourceOptionRow
                    isSelected={option.key === selectedOption?.key}
                    key={option.key}
                    onSelect={() => selectSource(option.key)}
                    option={option}
                    rounded="rounded-none"
                  />
                ))}
              </div>
            </SheetReveal>

            <div
              className={`t-hover flex w-full items-center rounded-2xl px-4 ${
                isSheetOpen ? "max-[1203px]:bg-black/[0.04]" : ""
              }`}
            >
              <button
                className="flex min-w-0 flex-1 items-center text-left"
                onClick={() => setIsSheetOpen((open) => !open)}
                type="button"
              >
                <span className="flex items-center py-2 pr-3">
                  {/* Cleanup-only phase has no sources; keep a sane cell. */}
                  {selectedOption?.icon ?? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      aria-hidden="true"
                      className="size-11"
                      src={`${ASSET_BASE}/earn-icon.svg`}
                    />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1 py-2">
                  <span className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
                    <TextSwap
                      text={`from ${selectedOption?.label ?? "Earn"}`}
                    />
                  </span>
                  <span className="whitespace-nowrap font-semibold text-[20px] text-black leading-6">
                    {/* Hiding masks through TextSwap's own swap animation
                        (churning it would thrash the swap). */}
                    <TextSwap
                      text={
                        isBalanceHidden
                          ? maskBalanceText(fromBalance.balanceWhole, "whole")
                          : fromBalance.balanceWhole
                      }
                    />
                    <span className="text-[rgba(60,60,67,0.4)]">
                      <TextSwap
                        text={
                          isBalanceHidden
                            ? maskBalanceText(
                                fromBalance.balanceFraction,
                                "fraction"
                              )
                            : fromBalance.balanceFraction
                        }
                      />
                    </span>
                  </span>
                </span>
              </button>
              <div className="pl-3">
                <button
                  className="t-hover min-w-16 rounded-full bg-black/[0.04] px-4 py-2.5 text-center font-medium text-[13px] text-black leading-4 hover:bg-black/[0.08]"
                  onClick={() => {
                    const usd = selectedOption?.usd ?? 0;
                    if (usd > 0) {
                      // Floor to cents so the label never rounds above the
                      // real balance (full exits withdraw the exact raw).
                      handleAmountChange(
                        (Math.floor(usd * 100) / 100).toFixed(2)
                      );
                    }
                  }}
                  type="button"
                >
                  MAX
                </button>
              </div>
              <button
                aria-label="Select position"
                className="t-hover -my-2.5 -mr-2.5 ml-0.5 flex size-11 items-center justify-center rounded-3xl hover:bg-black/[0.04] min-[1204px]:hidden"
                onClick={() => setIsSheetOpen((open) => !open)}
                type="button"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-6"
                  src={`${ASSET_BASE}/icon-chevron-grabber.svg`}
                />
              </button>
            </div>

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
                  {`to Stablecoins · ${addressLabel}`}
                </span>
                <p className="whitespace-nowrap font-semibold text-[20px] text-black leading-6">
                  <ScrambleText
                    isHidden={isBalanceHidden}
                    text={stablecoinsBalance.balanceWhole}
                  />
                  <span className="text-[rgba(60,60,67,0.4)]">
                    <ScrambleText
                      isHidden={isBalanceHidden}
                      text={stablecoinsBalance.balanceFraction}
                    />
                  </span>
                </p>
              </div>
            </div>

            <div className="-translate-y-1/2 absolute top-[calc(50%-2px)] left-[45px] h-3.5 w-0.5 rounded-xl bg-[#d9d9d9]" />
          </div>
        </div>

        <div className="w-full bg-white px-4 pt-2 pb-4">
          {data.actions.withdrawError ? (
            <p className="px-4 pb-2 text-[13px] leading-4 text-[#f9363c]">
              {data.actions.withdrawError}
            </p>
          ) : null}
          {isCleanupOnly ? (
            <>
              {/* Phase 2 of a full exit (slot-pinned zero proof happens
                  server-side in the prepare): close the empty Earn accounts
                  and reclaim their SOL rent. */}
              <p className="px-4 pb-2 text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
                Your funds are withdrawn. Close the empty Earn accounts to
                reclaim their SOL rent.
              </p>
              <button
                className="t-hover flex h-12 w-full items-center justify-center rounded-full bg-black font-medium text-[16px] text-white leading-5 enabled:hover:-translate-y-0.5 enabled:hover:bg-[#171717] enabled:active:translate-y-0"
                disabled={data.actions.isCleanupPending}
                onClick={() => void handleCleanup()}
                type="button"
              >
                <TextSwap
                  text={
                    data.actions.isCleanupPending
                      ? "Closing…"
                      : "Close policies"
                  }
                />
              </button>
            </>
          ) : (
            <button
              className={`t-hover flex h-12 w-full items-center justify-center rounded-full font-medium text-[16px] leading-5 ${
                canWithdraw
                  ? "bg-black text-white enabled:hover:-translate-y-0.5 enabled:hover:bg-[#171717] enabled:active:translate-y-0"
                  : "bg-[rgba(249,54,60,0.08)] text-[#f9363c]"
              }`}
              disabled={!canWithdraw || isSubmitting}
              onClick={() => void handleSubmit()}
              type="button"
            >
              <TextSwap
                text={
                  isSubmitting
                    ? "Withdrawing…"
                    : withdrawValidationError ?? "Withdraw"
                }
              />
            </button>
          )}
        </div>
      </section>

      {/* Positions selector replaces the chart pane while withdrawing; hidden
          below 1204px where the in-pane dropdown takes over. */}
      <aside className="hidden h-full w-[400px] shrink-0 flex-col overflow-clip rounded-3xl bg-white min-[1204px]:flex">
        <header className="flex w-full items-center p-2">
          <h2 className="min-w-0 flex-1 truncate py-2.5 pl-4 font-semibold text-[20px] text-black leading-6">
            Positions
          </h2>
        </header>
        <div className="flex w-full flex-col p-2">
          {options.map((option) => (
            <SourceOptionRow
              isSelected={option.key === selectedOption?.key}
              key={option.key}
              onSelect={() => selectSource(option.key)}
              option={option}
              rounded="rounded-2xl"
            />
          ))}
        </div>
      </aside>
    </>
  );
}
