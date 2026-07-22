"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { sanitizeBucksAmountInput } from "@/components/wallet-sidebar/earn-detail-view";
import {
  hiddenBalanceStyle,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { DualIcon } from "@/components/wallet-workspace/facelift/earn-activity-card";
import type { EarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import { useStablecoinsUsd } from "@/components/wallet-workspace/facelift/use-stablecoins-usd";
import type { ActiveEarnPositionHolding } from "@/hooks/use-active-earn-position";
import { splitUsdBalance } from "@/hooks/use-wallet-desktop-data";
import { rawTokenAmountToNumber } from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";
import { resolveEarnTransactionMarketIcon } from "@/lib/yield-optimization/earn-position-display";

const ASSET_BASE = "/wallet-workspace/facelift";
const ALL_POSITIONS_KEY = "all";

function holdingKey(holding: ActiveEarnPositionHolding) {
  return `${holding.kind}:${holding.reserve ?? holding.market ?? holding.label}`;
}

function holdingLabel(holding: ActiveEarnPositionHolding) {
  return holding.kind === "idle"
    ? `${holding.label} ${holding.marketName}`
    : `${holding.marketName} USDC`;
}

function holdingUsd(holding: ActiveEarnPositionHolding) {
  return rawTokenAmountToNumber(holding.amountRaw, 6);
}

type WithdrawSourceOption = {
  icon: ReactNode;
  key: string;
  label: string;
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
      className={`flex w-full items-center px-4 text-left hover:bg-black/[0.04] ${rounded}`}
      onClick={onSelect}
      type="button"
    >
      <span className="flex items-center py-2 pr-3">{option.icon}</span>
      <span className="flex h-[60px] min-w-0 flex-1 flex-col gap-0.5 py-[9px]">
        <span className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
          {option.label}
        </span>
        <span
          className="whitespace-nowrap font-semibold text-[20px] text-black leading-6"
          style={hiddenBalanceStyle(isBalanceHidden)}
        >
          {amount.balanceWhole}
          <span className="text-[rgba(60,60,67,0.4)]">
            {amount.balanceFraction}
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
// selector card in place of the chart pane. Withdraw itself is not wired yet.
export function WithdrawPane({
  data,
  onBack,
}: {
  data: EarnPositionData;
  onBack: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [selectedKey, setSelectedKey] = useState(ALL_POSITIONS_KEY);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const { isBalanceHidden } = useBalanceVisibility();

  const stablecoinsUsd = useStablecoinsUsd();
  const stablecoinsBalance = splitUsdBalance(stablecoinsUsd);
  const addressLabel = data.walletAddress
    ? `${data.walletAddress.slice(0, 4)}…${data.walletAddress.slice(-4)}`
    : "";

  const visibleHoldings = useMemo(
    () =>
      (data.position?.holdings ?? []).filter((holding) => {
        try {
          return BigInt(holding.amountRaw) > BigInt(0);
        } catch {
          return false;
        }
      }),
    [data.position?.holdings]
  );
  const options = useMemo<WithdrawSourceOption[]>(
    () => [
      {
        icon: (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            aria-hidden="true"
            className="size-11"
            src={`${ASSET_BASE}/earn-icon.svg`}
          />
        ),
        key: ALL_POSITIONS_KEY,
        label: "All Earn positions",
        usd: data.earnBalanceUsd,
      },
      ...visibleHoldings.map((holding) => ({
        icon: (
          <DualIcon
            frontSrc={resolveEarnTransactionMarketIcon({
              market: holding.market,
            })}
          />
        ),
        key: holdingKey(holding),
        label: holdingLabel(holding),
        usd: holdingUsd(holding),
      })),
    ],
    [data.earnBalanceUsd, visibleHoldings]
  );
  const selectedOption =
    options.find((option) => option.key === selectedKey) ?? options[0];
  const fromBalance = splitUsdBalance(selectedOption.usd);

  const amountUsd = Number.parseFloat(amount.replace(/,/g, "")) || 0;
  const canWithdraw = amountUsd > 0 && amountUsd <= selectedOption.usd;

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

  useEffect(() => {
    if (!isSheetOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSheetOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSheetOpen]);

  return (
    <>
      <section className="flex h-full min-w-0 flex-1 flex-col overflow-clip rounded-3xl bg-white">
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
              <>
                <button
                  aria-label="Close position select"
                  className="fixed inset-0 z-10 cursor-default min-[1204px]:hidden"
                  onClick={() => setIsSheetOpen(false)}
                  type="button"
                />
                <div className="absolute inset-x-2 bottom-full z-20 flex flex-col rounded-2xl bg-white/70 p-2 shadow-[0px_0px_2px_0px_rgba(0,0,0,0.08),0px_4px_16px_0px_rgba(0,0,0,0.08)] backdrop-blur-[16px] min-[1204px]:hidden">
                  {options.map((option) => (
                    <SourceOptionRow
                      isSelected={option.key === selectedOption.key}
                      key={option.key}
                      onSelect={() => selectSource(option.key)}
                      option={option}
                      rounded="rounded-lg"
                    />
                  ))}
                </div>
              </>
            ) : null}

            <div
              className={`flex w-full items-center rounded-2xl px-4 ${
                isSheetOpen ? "max-[1203px]:bg-black/[0.04]" : ""
              }`}
            >
              <button
                className="flex min-w-0 flex-1 items-center text-left"
                onClick={() => setIsSheetOpen((open) => !open)}
                type="button"
              >
                <span className="flex items-center py-2 pr-3">
                  {selectedOption.icon}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1 py-2">
                  <span className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
                    {`from ${selectedOption.label}`}
                  </span>
                  <span
                    className="whitespace-nowrap font-semibold text-[20px] text-black leading-6"
                    style={hiddenBalanceStyle(isBalanceHidden)}
                  >
                    {fromBalance.balanceWhole}
                    <span className="text-[rgba(60,60,67,0.4)]">
                      {fromBalance.balanceFraction}
                    </span>
                  </span>
                </span>
              </button>
              <div className="pl-3">
                <button
                  className="min-w-16 rounded-full bg-black/[0.04] px-4 py-2.5 text-center font-medium text-[13px] text-black leading-4"
                  onClick={() => {
                    if (selectedOption.usd > 0) {
                      handleAmountChange(selectedOption.usd.toFixed(2));
                    }
                  }}
                  type="button"
                >
                  MAX
                </button>
              </div>
              <button
                aria-label="Select position"
                className="flex items-center pl-3 min-[1204px]:hidden"
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

            <div className="-translate-y-1/2 absolute top-[calc(50%-2px)] left-[45px] h-3.5 w-0.5 rounded-xl bg-[#d9d9d9]" />
          </div>
        </div>

        <div className="w-full bg-white px-4 pt-2 pb-4">
          {canWithdraw ? (
            // ponytail: withdraw transaction not wired yet — button is a no-op
            <button
              className="flex h-12 w-full items-center justify-center rounded-full bg-black font-medium text-[16px] text-white leading-5"
              type="button"
            >
              Withdraw
            </button>
          ) : (
            <div className="flex h-12 w-full items-center justify-center rounded-full bg-[rgba(249,54,60,0.08)] font-medium text-[#f9363c] text-[16px] leading-5">
              Enter amount
            </div>
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
              isSelected={option.key === selectedOption.key}
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
