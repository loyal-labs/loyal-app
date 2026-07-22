"use client";

import { useMemo, useState } from "react";

import { sanitizeBucksAmountInput } from "@/components/wallet-sidebar/earn-detail-view";
import {
  hiddenBalanceStyle,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { usePublicEnv } from "@/contexts/public-env-context";
import { useEarnForecastApy } from "@/hooks/use-earn-forecast-apy";
import {
  splitUsdBalance,
  useWalletDesktopData,
} from "@/hooks/use-wallet-desktop-data";
import { formatEarnApyLabel } from "@/lib/kamino/earn-forecast.shared";
import { resolveTrackedKaminoUsdcMint } from "@/lib/kamino/kamino-usdc-position";

const ASSET_BASE = "/wallet-workspace/facelift";
const MIN_DEPOSIT_USD = 1;

// Figma 4693:65815 (empty / below minimum) + 4693:65625 (valid amount) +
// 4693:70280 (mobile: full-bleed, chart button in the header opens the chart
// sheet, system num keyboard under the focused amount input).
export function DepositPane({
  onBack,
  onOpenChart,
}: {
  onBack: () => void;
  onOpenChart: () => void;
}) {
  const data = useWalletDesktopData({});
  const publicEnv = usePublicEnv();
  const apy = useEarnForecastApy();
  const { isBalanceHidden } = useBalanceVisibility();
  const [amount, setAmount] = useState("");

  const usdcUsd = useMemo(() => {
    const usdcMint = resolveTrackedKaminoUsdcMint(publicEnv.solanaEnv);
    const position = data.positions.find(
      (candidate) => candidate.asset.mint === usdcMint
    );
    return position?.totalValueUsd ?? 0;
  }, [data.positions, publicEnv.solanaEnv]);
  const usdcBalance = splitUsdBalance(usdcUsd);

  const amountUsd = Number.parseFloat(amount.replace(/,/g, "")) || 0;
  const isValidAmount = amountUsd >= MIN_DEPOSIT_USD;

  const handleAmountChange = (rawValue: string) => {
    const sanitized = sanitizeBucksAmountInput(rawValue, amount);
    if (sanitized !== null) {
      setAmount(sanitized);
    }
  };

  return (
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
        <h1 className="min-w-0 flex-1 truncate py-2 font-semibold text-[20px] text-black leading-6">
          Deposit
        </h1>
        <button
          aria-label="Open chart"
          className="hidden size-11 shrink-0 items-center justify-center rounded-3xl max-[795px]:flex"
          onClick={onOpenChart}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-6"
            src={`${ASSET_BASE}/icon-chart.svg`}
          />
        </button>
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

          <div className="w-full px-2">
            <div className="flex w-full items-start px-4">
              <div className="flex items-center py-1 pr-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-6"
                  src={`${ASSET_BASE}/icon-circle-info.svg`}
                />
              </div>
              <p className="min-w-0 max-w-[400px] flex-1 py-2 text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
                Your first deposit takes ~0.06 SOL from your wallet for Solana
                account rent — it is returned when you fully withdraw.
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
                className="size-11 rounded-full"
                src="/wallet-workspace/earn-deposit-usdc.png"
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1 py-2">
              <span className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
                from USDC balance
              </span>
              <p
                className="whitespace-nowrap font-semibold text-[20px] text-black leading-6"
                style={hiddenBalanceStyle(isBalanceHidden)}
              >
                {usdcBalance.balanceWhole}
                <span className="text-[rgba(60,60,67,0.4)]">
                  {usdcBalance.balanceFraction}
                </span>
              </p>
            </div>
            <div className="pl-3">
              <button
                className="min-w-16 rounded-full bg-black/[0.04] px-4 py-2.5 text-center font-medium text-[13px] text-black leading-4"
                onClick={() => {
                  if (usdcUsd > 0) {
                    handleAmountChange(usdcUsd.toFixed(2));
                  }
                }}
                type="button"
              >
                MAX
              </button>
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
              <span className="flex items-center">
                <span className="inline-flex items-center gap-1 rounded-lg bg-[rgba(52,199,89,0.14)] px-2 py-0.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    aria-hidden="true"
                    className="h-5 w-3"
                    src="/wallet-workspace/earn-flash.svg"
                  />
                  <span className="whitespace-nowrap font-medium text-[#34c759] text-[16px] leading-5 tracking-[0.06px]">
                    {formatEarnApyLabel(apy.apyBps)}
                  </span>
                </span>
              </span>
            </div>
          </div>

          <div className="-translate-y-1/2 absolute top-[calc(50%-2px)] left-[45px] h-3.5 w-0.5 rounded-xl bg-[#d9d9d9]" />
        </div>
      </div>

      <div className="w-full bg-white px-4 pt-2 pb-4">
        {isValidAmount ? (
          <button
            className="flex h-12 w-full items-center justify-center rounded-full bg-black font-medium text-[16px] text-white leading-5"
            type="button"
          >
            Deposit
          </button>
        ) : (
          <div className="flex h-12 w-full items-center justify-center rounded-full bg-[rgba(249,54,60,0.08)] font-medium text-[#f9363c] text-[16px] leading-5">
            {`Minimum deposit is $${MIN_DEPOSIT_USD}`}
          </div>
        )}
      </div>
    </section>
  );
}
