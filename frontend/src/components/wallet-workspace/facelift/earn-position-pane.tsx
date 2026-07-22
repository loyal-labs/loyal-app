"use client";

import {
  AutodepositToggle,
  EarnGrowingBalance,
} from "@/components/wallet-sidebar/earn-detail-view";
import { EarnActivityCard } from "@/components/wallet-workspace/facelift/earn-activity-card";
import type { EarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import { useEarnForecastApy } from "@/hooks/use-earn-forecast-apy";
import { formatEarnApyLabel } from "@/lib/kamino/earn-forecast.shared";
import { formatAutodepositUsdLabel } from "@/lib/yield-optimization/earn-autodeposit-loaded-state.shared";

const ASSET_BASE = "/wallet-workspace/facelift";

// Figma 4693:67399 (Transactions) / 4693:67728 (Positions) — Earn middle pane
// when a position exists: balance + autodeposit card, then the activity card.
export function EarnPositionPane({
  data,
  onDeposit,
}: {
  data: EarnPositionData;
  onDeposit: () => void;
}) {
  const apy = useEarnForecastApy();
  const autodeposit = data.autodepositConfig;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-2 overflow-y-auto">
      <section className="flex w-full shrink-0 flex-col overflow-clip rounded-3xl bg-white">
        <header className="flex w-full items-center p-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-4">
            <h1 className="whitespace-nowrap font-semibold text-[24px] text-black leading-7">
              Earn
            </h1>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              aria-hidden="true"
              className="size-6"
              src={`${ASSET_BASE}/icon-question.svg`}
            />
          </div>
          <div className="flex shrink-0 items-start gap-2 pl-3">
            {/* ponytail: withdraw flow not redesigned yet — button unwired */}
            <button
              className="flex items-center justify-center gap-2 rounded-full bg-black/[0.04] p-2.5"
              type="button"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                aria-hidden="true"
                className="size-6"
                src={`${ASSET_BASE}/icon-withdraw-arrow.svg`}
              />
              <span className="whitespace-nowrap pr-2.5 font-medium text-[16px] text-black leading-5">
                Withdraw
              </span>
            </button>
            <button
              className="flex items-center justify-center gap-2 rounded-full bg-black p-2.5"
              onClick={onDeposit}
              type="button"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                aria-hidden="true"
                className="size-6"
                src={`${ASSET_BASE}/icon-plus.svg`}
              />
              <span className="whitespace-nowrap pr-2.5 font-medium text-[16px] text-white leading-5">
                Deposit
              </span>
            </button>
          </div>
        </header>

        <div className="w-full p-2">
          <div className="flex h-[86px] w-full flex-col items-start gap-0.5 rounded-[20px] px-4 py-2">
            <div className="flex items-start gap-1">
              <p className="whitespace-nowrap text-[16px] leading-5 text-[rgba(60,60,67,0.6)]">
                {"Balance · "}
                <span className="text-[#34c759]">
                  {formatEarnApyLabel(apy.apyBps)}
                </span>
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                aria-hidden="true"
                className="size-5"
                src={`${ASSET_BASE}/icon-question.svg`}
              />
            </div>
            <EarnGrowingBalance baseAmount={data.earnBalanceUsd} />
          </div>
        </div>

        {autodeposit ? (
          <div className="w-full p-2">
            <div className="flex w-full items-center rounded-2xl px-4">
              <div className="py-2 pr-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-11 shrink-0"
                  src={`${ASSET_BASE}/autodeposit-icon.svg`}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
                <p className="truncate font-medium text-[16px] text-black leading-5 tracking-[-0.176px]">
                  Autodeposit
                </p>
                <p className="truncate text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
                  {`Anything above ${formatAutodepositUsdLabel(autodeposit.keepAmount)}`}
                </p>
              </div>
              <div className="flex items-center justify-end gap-1 pl-3">
                {/* ponytail: autodeposit settings + toggle actions still live
                    in the old workspace's inline callbacks — display-only
                    until write actions are wired. */}
                <button
                  aria-label="Autodeposit settings"
                  className="flex size-11 items-center justify-center rounded-[20px]"
                  type="button"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    aria-hidden="true"
                    className="size-6"
                    src={`${ASSET_BASE}/icon-settings-slider.svg`}
                  />
                </button>
                <AutodepositToggle
                  isOn={autodeposit.state === "created"}
                  isPending={autodeposit.state === "creating"}
                />
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <EarnActivityCard
        holdings={data.position?.holdings ?? []}
        scheduledSweeps={data.scheduledSweeps}
        settingsPda={data.settingsPda}
        walletAddress={data.walletAddress}
      />
    </div>
  );
}
