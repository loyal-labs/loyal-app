"use client";

import { CircleDollarSign, Landmark, PenLine, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { sanitizeBucksAmountInput } from "@/components/wallet-sidebar/earn-detail-view";
import {
  ScrambleText,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import {
  FlowDiagram,
  FlowExplainerAside,
  FlowExplainerOverlay,
  type FlowStep,
} from "@/components/wallet-workspace/facelift/flow-explainer";
import { PopDigits } from "@/components/wallet-workspace/facelift/pop-digits";
import { SkeletonReveal } from "@/components/wallet-workspace/facelift/skeleton-reveal";
import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import { useEarnForecastApyStatus } from "@/components/wallet-workspace/facelift/use-earn-forecast-apy-status";
import type { EarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import { usePublicEnv } from "@/contexts/public-env-context";
import {
  splitUsdBalance,
  useWalletDesktopData,
} from "@/hooks/use-wallet-desktop-data";
import { formatEarnApyLabel } from "@/lib/kamino/earn-forecast.shared";
import { resolveTrackedKaminoUsdcMint } from "@/lib/kamino/kamino-usdc-position";
import { getTokenIconUrl } from "@/lib/token-icon";

const ASSET_BASE = "/wallet-workspace/facelift";
const MIN_DEPOSIT_USD = 1;

// The deposit's path told as steps — amount, one signature, where the USDC
// actually goes, and what earning/withdrawing look like (user-docs
// automations/routing-and-yield.mdx: vault → approved lending market, USDC
// stays USDC; rates are variable).
const DEPOSIT_STEPS: readonly FlowStep[] = [
  {
    Icon: CircleDollarSign,
    body: `Pick how much USDC to move from your wallet into Earn. The minimum is $${MIN_DEPOSIT_USD}.`,
    title: "Choose an amount",
  },
  {
    Icon: PenLine,
    body: "One signature sends the deposit through your own smart account — Loyal never takes custody of your funds.",
    title: "Approve in your wallet",
  },
  {
    Icon: Landmark,
    body: "It lands in your Earn vault, then an approved USDC lending market on Kamino. USDC stays USDC — it is never swapped.",
    title: "Your USDC is lent out",
  },
  {
    Icon: TrendingUp,
    body: "Interest accrues continuously at a variable rate. Withdraw back to your wallet anytime.",
    title: "Earning starts right away",
  },
];

const DEPOSIT_FOOTNOTE =
  "Rates are variable, and supplied funds carry the risks of the underlying lending market.";

const DEPOSIT_DOCS_URL =
  "https://docs.askloyal.com/automations/routing-and-yield";

// Figma 4693:65815 (empty / below minimum) + 4693:65625 (valid amount) +
// 4693:70280 (mobile: full-bleed, chart button in the header opens the chart
// sheet, system num keyboard under the focused amount input).
export function DepositPane({
  data: earnData,
  onBack,
  onOpenChart,
}: {
  data: EarnPositionData;
  onBack: () => void;
  onOpenChart: () => void;
}) {
  const data = useWalletDesktopData({});
  const publicEnv = usePublicEnv();
  const { apy, isLoaded: isApyLoaded } = useEarnForecastApyStatus();
  const { isBalanceHidden } = useBalanceVisibility();
  const [amount, setAmount] = useState("");
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const { actions } = earnData;

  const positionsUsdcUsd = useMemo(() => {
    const usdcMint = resolveTrackedKaminoUsdcMint(publicEnv.solanaEnv);
    const position = data.positions.find(
      (candidate) => candidate.asset.mint === usdcMint
    );
    return position?.totalValueUsd ?? 0;
  }, [data.positions, publicEnv.solanaEnv]);
  // Same funding balance the old workspace shows: live wallet USDC ATA read,
  // portfolio-position value as the fallback while it loads.
  const usdcUsd = actions.mainUsdcAmount ?? positionsUsdcUsd;
  const usdcBalance = splitUsdBalance(usdcUsd);

  const amountUsd = Number.parseFloat(amount.replace(/,/g, "")) || 0;
  const amountLabel = amountUsd.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
  const isBelowMinimum = amountUsd < MIN_DEPOSIT_USD;
  const isInsufficient = !isBelowMinimum && amountUsd > usdcUsd;
  const isValidAmount = !isBelowMinimum && !isInsufficient;
  const isSubmitting = actions.isDepositPending;

  // Warm the Kamino instruction fetch while the user pauses on a valid
  // amount, so hitting Deposit skips the prepare's longest network leg.
  const prefetchDeposit = actions.prefetchDepositPreparation;
  useEffect(() => {
    if (!isValidAmount) {
      return;
    }
    const timer = window.setTimeout(() => prefetchDeposit(amount), 300);
    return () => window.clearTimeout(timer);
  }, [amount, isValidAmount, prefetchDeposit]);

  const handleAmountChange = (rawValue: string) => {
    const sanitized = sanitizeBucksAmountInput(rawValue, amount);
    if (sanitized !== null) {
      setAmount(sanitized);
    }
  };
  const handleSubmit = async () => {
    const didDeposit = await actions.submitDeposit({
      amountLabel: amount,
      forecastApyBps: apy.apyBps,
    });
    if (didDeposit) {
      onBack();
    }
  };

  return (
    <>
      <section className="flex h-full min-w-0 flex-1 flex-col overflow-clip rounded-3xl bg-card max-[795px]:rounded-none">
        <header className="flex w-full items-center p-2">
          <div className="pr-3">
            <button
              aria-label="Back"
              className="t-hover flex size-11 items-center justify-center rounded-3xl hover:bg-accent"
              onClick={onBack}
              type="button"
            >
              <ThemedIcon
                className="size-6 text-muted-foreground"
                src={`${ASSET_BASE}/icon-arrow-left.svg`}
              />
            </button>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 py-2">
            <h1 className="truncate font-semibold text-[20px] text-foreground leading-6">
              Deposit
            </h1>
            <button
              aria-label="How Deposit works"
              className="t-hover -m-2.5 flex size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-accent min-[1204px]:hidden"
              onClick={() => setIsInfoOpen(true)}
              type="button"
            >
              <ThemedIcon
                className="size-6 text-tertiary"
                src={`${ASSET_BASE}/icon-question.svg`}
              />
            </button>
          </div>
          <button
            aria-label="Open chart"
            className="t-hover hidden size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-accent max-[795px]:flex"
            onClick={onOpenChart}
            type="button"
          >
            <ThemedIcon
              className="size-6 text-muted-foreground"
              src={`${ASSET_BASE}/icon-chart.svg`}
            />
          </button>
        </header>

        <div className="flex min-h-0 w-full flex-1 flex-col">
          <div className="flex w-full flex-1 flex-col">
            <div className="w-full p-2">
              <label className="flex w-full flex-col gap-0.5 rounded-2xl px-4 py-2">
                <span className="whitespace-nowrap text-[16px] leading-5 text-muted-foreground">
                  Amount
                </span>
                <span className="flex h-12 w-full items-baseline">
                  <span className="font-semibold text-[40px] text-foreground leading-[48px]">
                    $
                  </span>
                  <input
                    autoFocus
                    className="min-w-0 flex-1 border-none bg-transparent font-semibold text-[40px] text-foreground leading-[48px] outline-none placeholder:text-tertiary"
                    inputMode="decimal"
                    onChange={(event) => handleAmountChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.repeat) {
                        return;
                      }
                      event.preventDefault();
                      if (isValidAmount && !isSubmitting) {
                        void handleSubmit();
                      }
                    }}
                    placeholder="0"
                    type="text"
                    value={amount}
                  />
                </span>
              </label>
            </div>

            {/* Rent disclaimer only concerns the FIRST deposit — an existing
              position's accounts already paid it. */}
            {earnData.hasPosition ? null : (
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
                  <p className="min-w-0 max-w-[400px] flex-1 py-2 text-[13px] leading-4 text-muted-foreground">
                    Your first deposit takes ~0.06 SOL from your wallet for
                    Solana account rent — it is returned when you fully
                    withdraw.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="relative flex h-36 w-full flex-col gap-1 overflow-clip p-2">
            <div className="flex w-full items-center rounded-2xl px-4">
              <div className="py-2 pr-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-11 rounded-full"
                  src={getTokenIconUrl("USDC")}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 py-2">
                <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
                  from USDC balance
                </span>
                <p className="whitespace-nowrap font-semibold text-[20px] text-foreground leading-6">
                  <ScrambleText
                    isHidden={isBalanceHidden}
                    text={usdcBalance.balanceWhole}
                  />
                  <span className="text-tertiary">
                    <ScrambleText
                      isHidden={isBalanceHidden}
                      text={usdcBalance.balanceFraction}
                    />
                  </span>
                </p>
              </div>
              <div className="pl-3">
                <button
                  className="t-hover min-w-16 rounded-full bg-accent px-4 py-2.5 text-center font-medium text-[13px] text-foreground leading-4 hover:bg-accent-active"
                  onClick={() => {
                    if (usdcUsd > 0) {
                      // Floor to cents so the fill never rounds above the real
                      // balance (toFixed would turn 1.8699 into an
                      // "insufficient" 1.87), same as the withdraw pane's MAX.
                      handleAmountChange(
                        (Math.floor(usdcUsd * 100) / 100).toFixed(2)
                      );
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
                <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
                  to Earn
                </span>
                <span className="flex items-center">
                  {/* Skeleton the badge until the real APY lands, then reveal
                    + pop — the fallback APY would otherwise flash. */}
                  <SkeletonReveal
                    isRevealed={isApyLoaded}
                    skeletonClassName="rounded-lg bg-accent-selected"
                  >
                    <span className="inline-flex items-center gap-1 rounded-lg bg-positive/[0.14] px-2 py-0.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt=""
                        aria-hidden="true"
                        className="h-5 w-3"
                        src="/wallet-workspace/earn-flash.svg"
                      />
                      <span className="whitespace-nowrap font-medium text-positive text-[16px] leading-5 tracking-[0.06px]">
                        {isApyLoaded ? (
                          <PopDigits
                            segments={[
                              { text: formatEarnApyLabel(apy.apyBps) },
                            ]}
                          />
                        ) : (
                          formatEarnApyLabel(apy.apyBps)
                        )}
                      </span>
                    </span>
                  </SkeletonReveal>
                </span>
              </div>
            </div>

            <div className="-translate-y-1/2 absolute top-[calc(50%-2px)] left-[45px] h-3.5 w-0.5 rounded-xl bg-border" />
          </div>
        </div>

        <div className="w-full bg-card px-4 pt-2 pb-4">
          {actions.depositError ? (
            <p className="px-4 pb-2 text-[13px] leading-4 text-destructive">
              {actions.depositError}
            </p>
          ) : null}
          {/* One persistent pill so the label swaps in place (transitions.dev
            text states swap); disabled stands in for the old inert div. */}
          <button
            className={`t-hover flex h-12 w-full items-center justify-center rounded-full font-medium text-[16px] leading-5 ${
              isValidAmount
                ? "bg-foreground text-background enabled:hover:-translate-y-0.5 enabled:hover:bg-foreground/90 enabled:active:translate-y-0"
                : "bg-destructive/[0.08] text-destructive"
            }`}
            disabled={!isValidAmount || isSubmitting}
            onClick={() => void handleSubmit()}
            type="button"
          >
            <TextSwap
              text={
                isSubmitting
                  ? "Depositing…"
                  : isInsufficient
                  ? "Insufficient balance"
                  : isValidAmount
                  ? `Deposit ${amountLabel} USDC`
                  : `Minimum deposit is $${MIN_DEPOSIT_USD}`
              }
            />
          </button>
        </div>
      </section>

      {/* Explainer: fixed right pane on wide viewports (the slot the chart
        column vacates for this screen), overlay via the header ? below
        1204px — same split the Autodeposit screen uses. */}
      <FlowExplainerAside title="How Deposit works">
        <FlowDiagram
          docsHref={DEPOSIT_DOCS_URL}
          footnote={DEPOSIT_FOOTNOTE}
          steps={DEPOSIT_STEPS}
        />
      </FlowExplainerAside>

      <FlowExplainerOverlay
        isOpen={isInfoOpen}
        onClose={() => setIsInfoOpen(false)}
        title="How Deposit works"
      >
        <FlowDiagram
          docsHref={DEPOSIT_DOCS_URL}
          footnote={DEPOSIT_FOOTNOTE}
          steps={DEPOSIT_STEPS}
        />
      </FlowExplainerOverlay>
    </>
  );
}
