"use client";

import {
  resolveLoyalClusterForSolanaEnv,
  Stablecoin,
} from "@loyal-labs/actions";
import { resolveSolanaEnv } from "@loyal-labs/solana-rpc";
import { CircleDollarSign, Landmark, PenLine, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { sanitizeBucksAmountInput } from "@/components/wallet-sidebar/earn-detail-view";
import {
  ScrambleText,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { DropdownReveal } from "@/components/wallet-workspace/facelift/dropdown-reveal";
import {
  FlowDiagram,
  FlowExplainerAside,
  FlowExplainerOverlay,
  type FlowStep,
} from "@/components/wallet-workspace/facelift/flow-explainer";
import { PopDigits } from "@/components/wallet-workspace/facelift/pop-digits";
import { SheetReveal } from "@/components/wallet-workspace/facelift/sheet-reveal";
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
import { getTokenIconUrl } from "@/lib/token-icon";
import { getEarnProductAssetsForCluster } from "@/lib/yield-optimization/earn-product-mints.shared";

const ASSET_BASE = "/wallet-workspace/facelift";
const MIN_DEPOSIT_USD = 1;

type DepositSourceOption = {
  key: string;
  mint: string;
  symbol: string;
  usd: number;
};

function DepositSourceOptionRow({
  isSelected,
  onSelect,
  option,
  rounded,
}: {
  isSelected: boolean;
  onSelect: () => void;
  option: DepositSourceOption;
  rounded: string;
}) {
  const balance = splitUsdBalance(option.usd);
  const { isBalanceHidden } = useBalanceVisibility();
  // Nothing to deposit from an empty balance — the row stays visible (so
  // the product set reads complete) but cannot be picked.
  const isEmpty = option.usd <= 0;

  return (
    <button
      aria-pressed={isSelected}
      className={`t-hover flex w-full items-center px-4 text-left disabled:opacity-40 enabled:hover:bg-accent ${rounded}`}
      disabled={isEmpty}
      onClick={onSelect}
      type="button"
    >
      <span className="flex items-center py-2 pr-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          aria-hidden="true"
          className="size-11 rounded-full"
          src={getTokenIconUrl(option.symbol)}
        />
      </span>
      <span className="flex h-[60px] min-w-0 flex-1 flex-col gap-0.5 py-[9px]">
        <span className="whitespace-nowrap text-[13px] text-muted-foreground leading-4">
          {option.symbol} balance
        </span>
        <span className="whitespace-nowrap font-semibold text-[20px] text-foreground leading-6">
          <ScrambleText
            isHidden={isBalanceHidden}
            text={balance.balanceWhole}
          />
          <span className="text-tertiary">
            <ScrambleText
              isHidden={isBalanceHidden}
              text={balance.balanceFraction}
            />
          </span>
        </span>
      </span>
      {isSelected ? (
        <span className="flex items-center justify-end pl-3">
          <ThemedIcon
            className="size-6 text-primary"
            src={`${ASSET_BASE}/icon-check-red.svg`}
          />
        </span>
      ) : null}
    </button>
  );
}

// The selected asset remains the same mint through deposit and routing.
const createDepositSteps = (symbol: string): readonly FlowStep[] => [
  {
    Icon: CircleDollarSign,
    body: `Pick how much ${symbol} to move from your wallet into Earn. The minimum is $${MIN_DEPOSIT_USD}.`,
    title: "Choose an amount",
  },
  {
    Icon: PenLine,
    body: "One signature sends the deposit through your own smart account — Loyal never takes custody of your funds.",
    title: "Approve in your wallet",
  },
  {
    Icon: Landmark,
    body: `It lands in your Earn vault, then an approved ${symbol} lending market on Kamino. ${symbol} stays ${symbol} — it is never swapped.`,
    title: `Your ${symbol} is lent out`,
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
  initialSourceKey,
  onBack,
  onOpenChart,
}: {
  data: EarnPositionData;
  /** Preselects the deposit source (keys are mints) — e.g. a stables-row
   * Earn pill. Unknown or absent keys fall back to the default source. */
  initialSourceKey?: string | null;
  onBack: () => void;
  onOpenChart: () => void;
}) {
  const data = useWalletDesktopData({});
  const publicEnv = usePublicEnv();
  const { apy, isLoaded: isApyLoaded } = useEarnForecastApyStatus();
  const { isBalanceHidden } = useBalanceVisibility();
  const [amount, setAmount] = useState("");
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isSourceSheetOpen, setIsSourceSheetOpen] = useState(false);
  const [selectedSourceKey, setSelectedSourceKey] = useState(
    initialSourceKey ?? ""
  );
  const { actions } = earnData;
  // The funding balance is only auto-refreshed after Earn transactions, so
  // re-read it on open to pick up swaps and external transfers (ASK-2096).
  const { refreshMainUsdcAmount } = actions;
  useEffect(() => {
    void refreshMainUsdcAmount();
  }, [refreshMainUsdcAmount]);

  const sourceOptions = useMemo<DepositSourceOption[]>(() => {
    const cluster = resolveLoyalClusterForSolanaEnv(
      resolveSolanaEnv(publicEnv.solanaEnv)
    );
    return getEarnProductAssetsForCluster(cluster).map((asset) => {
      const mint = asset.mint.toBase58();
      const position = data.positions.find(
        (candidate) => candidate.asset.mint === mint
      );
      const portfolioUsd =
        position?.publicValueUsd ?? position?.publicBalance ?? 0;
      return {
        key: mint,
        mint,
        symbol: asset.symbol,
        usd:
          asset.stablecoin === Stablecoin.USDC &&
          actions.mainUsdcAmount !== null
            ? actions.mainUsdcAmount
            : portfolioUsd,
      };
    });
  }, [actions.mainUsdcAmount, data.positions, publicEnv.solanaEnv]);
  // Default to USDC, but when it has no balance prefer the funded stablecoin
  // (largest balance) so a fully swapped wallet doesn't open on a $0 source.
  const defaultSource = useMemo(() => {
    const usdc = sourceOptions.find(
      (source) => source.symbol === Stablecoin.USDC
    );
    if (usdc && usdc.usd > 0) {
      return usdc;
    }
    const funded = sourceOptions.reduce<DepositSourceOption | null>(
      (best, source) =>
        source.usd > 0 && source.usd > (best?.usd ?? 0) ? source : best,
      null
    );
    return funded ?? usdc ?? sourceOptions[0]!;
  }, [sourceOptions]);
  const selectedSource =
    sourceOptions.find((source) => source.key === selectedSourceKey) ??
    defaultSource;
  // The selector opens upward from the trigger, so funded coins sit at the
  // bottom (nearest the trigger) and empty ones at the top — stable sort
  // keeps the product order within each group.
  const listedSourceOptions = useMemo(
    () =>
      [...sourceOptions].sort(
        (a, b) => (a.usd > 0 ? 1 : 0) - (b.usd > 0 ? 1 : 0)
      ),
    [sourceOptions]
  );
  const sourceUsd = selectedSource.usd;
  const depositSteps = useMemo(
    () => createDepositSteps(selectedSource.symbol),
    [selectedSource.symbol]
  );
  const sourceBalance = splitUsdBalance(sourceUsd);

  const amountUsd = Number.parseFloat(amount.replace(/,/g, "")) || 0;
  const amountLabel = amountUsd.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
  const minDepositUsd = MIN_DEPOSIT_USD;
  const isBelowMinimum = amountUsd < minDepositUsd;
  const isInsufficient = !isBelowMinimum && amountUsd > sourceUsd;
  const isValidAmount = !(isBelowMinimum || isInsufficient);
  const isSubmitting = actions.isDepositPending;

  // Warm the Kamino instruction fetch while the user pauses on a valid
  // amount, so hitting Deposit skips the prepare's longest network leg.
  const prefetchDeposit = actions.prefetchDepositPreparation;
  useEffect(() => {
    if (!isValidAmount) {
      return;
    }
    const timer = window.setTimeout(
      () => prefetchDeposit(amount, selectedSource.mint),
      300
    );
    return () => window.clearTimeout(timer);
  }, [amount, isValidAmount, prefetchDeposit, selectedSource.mint]);

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
      mint: selectedSource.mint,
      symbol: selectedSource.symbol,
    });
    if (didDeposit) {
      onBack();
    }
  };
  const selectSource = (key: string) => {
    setSelectedSourceKey(key);
    setIsSourceSheetOpen(false);
  };

  useEffect(() => {
    if (!isSourceSheetOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsSourceSheetOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSourceSheetOpen]);

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
                <span className="whitespace-nowrap text-[16px] text-muted-foreground leading-5">
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
                  <p className="min-w-0 max-w-[400px] flex-1 py-2 text-[13px] text-muted-foreground leading-4">
                    Your first deposit takes ~0.06 SOL from your wallet for
                    Solana account rent — it is returned when you fully
                    withdraw.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="relative flex h-36 w-full flex-col gap-1 p-2">
            {isSourceSheetOpen ? (
              <button
                aria-label="Close stablecoin select"
                className="fixed inset-0 z-10 cursor-default max-[795px]:hidden"
                onClick={() => setIsSourceSheetOpen(false)}
                type="button"
              />
            ) : null}
            <DropdownReveal
              className="absolute inset-x-2 bottom-full z-20 flex flex-col rounded-2xl bg-popover/70 p-2 shadow-[0px_0px_2px_0px_rgba(0,0,0,0.08),0px_4px_16px_0px_rgba(0,0,0,0.08)] backdrop-blur-[16px] max-[795px]:hidden"
              isOpen={isSourceSheetOpen}
              origin="bottom-center"
            >
              {listedSourceOptions.map((option) => (
                <DepositSourceOptionRow
                  isSelected={option.key === selectedSource.key}
                  key={option.key}
                  onSelect={() => selectSource(option.key)}
                  option={option}
                  rounded="rounded-lg"
                />
              ))}
            </DropdownReveal>
            <SheetReveal
              isOpen={isSourceSheetOpen}
              onClose={() => setIsSourceSheetOpen(false)}
              scrimClassName="fixed inset-0 z-50 hidden flex-col justify-end bg-white/60 pt-8 backdrop-blur-[4px] max-[795px]:flex"
              sheetClassName="flex w-full flex-col rounded-t-3xl bg-card shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
            >
              <header className="flex w-full items-center p-2">
                <h2 className="min-w-0 flex-1 truncate py-2.5 pl-2 font-semibold text-[20px] text-foreground leading-6">
                  Stablecoins
                </h2>
                <button
                  aria-label="Close stablecoin select"
                  className="t-hover flex size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-accent"
                  onClick={() => setIsSourceSheetOpen(false)}
                  type="button"
                >
                  <ThemedIcon
                    className="size-6 text-muted-foreground"
                    src={`${ASSET_BASE}/icon-cross.svg`}
                  />
                </button>
              </header>
              <div className="flex w-full flex-col py-2">
                {listedSourceOptions.map((option) => (
                  <DepositSourceOptionRow
                    isSelected={option.key === selectedSource.key}
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
                isSourceSheetOpen ? "bg-accent" : ""
              }`}
            >
              <button
                aria-expanded={isSourceSheetOpen}
                aria-label="Select deposit stablecoin"
                className="flex min-w-0 flex-1 items-center text-left"
                onClick={() => setIsSourceSheetOpen((open) => !open)}
                type="button"
              >
                <span className="flex items-center py-2 pr-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    aria-hidden="true"
                    className="size-11 rounded-full"
                    src={getTokenIconUrl(selectedSource.symbol)}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1 py-2">
                  <span className="whitespace-nowrap text-[13px] text-muted-foreground leading-4">
                    {`from ${selectedSource.symbol} balance`}
                  </span>
                  <span className="whitespace-nowrap font-semibold text-[20px] text-foreground leading-6">
                    <ScrambleText
                      isHidden={isBalanceHidden}
                      text={sourceBalance.balanceWhole}
                    />
                    <span className="text-tertiary">
                      <ScrambleText
                        isHidden={isBalanceHidden}
                        text={sourceBalance.balanceFraction}
                      />
                    </span>
                  </span>
                </span>
              </button>
              <div className="pl-3">
                <button
                  className="t-hover min-w-16 rounded-full bg-accent px-4 py-2.5 text-center font-medium text-[13px] text-foreground leading-4 hover:bg-accent-active"
                  onClick={() => {
                    if (sourceUsd > 0) {
                      // Floor to cents so the fill never rounds above the real
                      // balance (toFixed would turn 1.8699 into an
                      // "insufficient" 1.87), same as the withdraw pane's MAX.
                      handleAmountChange(
                        (Math.floor(sourceUsd * 100) / 100).toFixed(2)
                      );
                    }
                  }}
                  type="button"
                >
                  MAX
                </button>
              </div>
              <button
                aria-expanded={isSourceSheetOpen}
                aria-label="Select deposit stablecoin"
                className="t-hover -my-2.5 -mr-2.5 ml-0.5 flex size-11 items-center justify-center rounded-3xl hover:bg-accent"
                onClick={() => setIsSourceSheetOpen((open) => !open)}
                type="button"
              >
                <ThemedIcon
                  className="size-6 text-muted-foreground"
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
                  src={`${ASSET_BASE}/earn-icon.svg`}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 py-2">
                <span className="whitespace-nowrap text-[13px] text-muted-foreground leading-4">
                  to Earn
                </span>
                <span className="flex items-center">
                  {/* Skeleton the badge until the real APY lands, then
                    reveal + pop — the fallback APY would otherwise flash. */}
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
                      <span className="whitespace-nowrap font-medium text-[16px] text-positive leading-5 tracking-[0.06px]">
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

            <div className="absolute top-[calc(50%-2px)] left-[45px] h-3.5 w-0.5 -translate-y-1/2 rounded-xl bg-border" />
          </div>
        </div>

        <div className="w-full bg-card px-4 pt-2 pb-4">
          {actions.depositError ? (
            <p className="px-4 pb-2 text-[13px] text-destructive leading-4">
              {actions.depositError}
            </p>
          ) : null}
          {/* One persistent pill so the label swaps in place (transitions.dev
            text states swap); disabled stands in for the old inert div. */}
          <button
            className={`t-hover flex h-12 w-full items-center justify-center rounded-full font-medium text-[16px] leading-5 ${
              isValidAmount
                ? "bg-foreground text-background enabled:active:translate-y-0 enabled:hover:-translate-y-0.5 enabled:hover:bg-foreground/90"
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
                  ? `Deposit ${amountLabel} ${selectedSource.symbol}`
                  : `Minimum deposit is $${minDepositUsd.toLocaleString(
                      "en-US"
                    )}`
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
          steps={depositSteps}
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
          steps={depositSteps}
        />
      </FlowExplainerOverlay>
    </>
  );
}
