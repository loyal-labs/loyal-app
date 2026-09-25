"use client";

import { Infinity as InfinityIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { sanitizeBucksAmountInput } from "@/components/wallet-sidebar/earn-detail-view";
import {
  ScrambleText,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import type { EarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import {
  EARN_MAX_FALLBACK_APY_BPS,
  EARN_MAX_STRATEGY_NAME,
  type EarnMaxActions,
  type EarnMaxViewModel,
} from "@/features/earn-max";
import {
  splitUsdBalance,
  useWalletDesktopData,
} from "@/hooks/use-wallet-desktop-data";
import { getTokenIconUrl } from "@/lib/token-icon";

const ASSET_BASE = "/wallet-workspace/facelift";
const MIN_DEPOSIT_USD = 1;

export function formatEarnMaxApyLabel(bps: number | null): string {
  return `${((bps ?? EARN_MAX_FALLBACK_APY_BPS) / 100).toFixed(2)}% APY`;
}

/** Red Earn MAX marker (the strategy's infinity glyph on the brand red). */
export function EarnMaxInfinityBadge({ className }: { className: string }) {
  return (
    <span
      className={`flex items-center justify-center rounded-full bg-primary ${className}`}
    >
      <InfinityIcon aria-hidden="true" className="size-[55%] text-white" />
    </span>
  );
}

/** USDC coin + the red Earn MAX marker, source top-left → destination
 * bottom-right — same direction contract as the Earn activity DualIcon:
 * deposits read Main → Earn MAX, withdrawals Earn MAX → Main. */
export function EarnMaxDualIcon({
  isWithdraw = false,
}: {
  isWithdraw?: boolean;
}) {
  const coin = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      className="absolute inset-0 size-full"
      src={getTokenIconUrl("USDC")}
    />
  );
  const marker = <EarnMaxInfinityBadge className="size-full" />;
  return (
    <span className="relative block size-11 shrink-0">
      <span className="absolute top-0 left-0 block size-[30px] overflow-hidden rounded-full">
        {isWithdraw ? marker : coin}
      </span>
      <span className="absolute right-0 bottom-0 block size-[30px] overflow-hidden rounded-full">
        {isWithdraw ? coin : marker}
      </span>
    </span>
  );
}

/** Figma 5429:37666 — right-rail placeholder card until real copy lands. */
export function EarnMaxInfoFaqsCard({ className }: { className: string }) {
  return (
    <div className={`flex-col overflow-clip rounded-3xl bg-card ${className}`}>
      <header className="flex w-full items-center p-2">
        <h2 className="min-w-0 flex-1 truncate py-2.5 pl-4 font-semibold text-[20px] text-foreground leading-6">
          Info &amp; FAQs
        </h2>
      </header>
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <p className="font-medium text-[20px] text-muted-foreground leading-6">
          Content
        </p>
      </div>
    </div>
  );
}

// "1,010.22" → 1010220000n (USDC's 6 decimals); null when not a plain amount.
function parseUsdcRaw(value: string): bigint | null {
  const cleaned = value.replaceAll(",", "");
  if (!/^\d+(?:\.\d{0,6})?$/.test(cleaned)) {
    return null;
  }
  const [whole = "0", fraction = ""] = cleaned.split(".");
  return (
    BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0") || "0")
  );
}

function ActionHeader({ onBack, title }: { onBack: () => void; title: string }) {
  return (
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
      <h1 className="min-w-0 flex-1 truncate py-2 font-semibold text-[20px] text-foreground leading-6">
        {title}
      </h1>
    </header>
  );
}

function AmountField({
  amount,
  isValidAmount,
  onChange,
  onSubmit,
}: {
  amount: string;
  isValidAmount: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
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
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.repeat) {
                return;
              }
              event.preventDefault();
              if (isValidAmount) {
                onSubmit();
              }
            }}
            placeholder="0"
            type="text"
            value={amount}
          />
        </span>
      </label>
    </div>
  );
}

function CaptionNote({ text, tone }: { text: string; tone: "info" | "warn" }) {
  return (
    <div className="w-full px-2">
      <div className="flex w-full items-start px-4">
        <div className="flex items-center py-1 pr-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-6"
            src={`${ASSET_BASE}/${
              tone === "warn"
                ? "icon-exclamation-circle.svg"
                : "icon-circle-info.svg"
            }`}
          />
        </div>
        <p
          className={`min-w-0 max-w-[400px] flex-1 py-2 text-[13px] leading-4 ${
            tone === "warn" ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {text}
        </p>
      </div>
    </div>
  );
}

function SubmitBar({
  error,
  isSubmitting,
  isValidAmount,
  label,
  onSubmit,
}: {
  error: string | null;
  isSubmitting: boolean;
  isValidAmount: boolean;
  label: string;
  onSubmit: () => void;
}) {
  return (
    <div className="w-full bg-card px-4 pt-2 pb-4">
      {error ? (
        <p className="px-4 pb-2 text-[13px] text-destructive leading-4">
          {error}
        </p>
      ) : null}
      <button
        className={`t-hover flex h-12 w-full items-center justify-center rounded-full font-medium text-[16px] leading-5 ${
          isValidAmount
            ? "bg-foreground text-background enabled:active:translate-y-0 enabled:hover:-translate-y-0.5 enabled:hover:bg-foreground/90"
            : "bg-destructive/[0.08] text-destructive"
        }`}
        disabled={!isValidAmount || isSubmitting}
        onClick={onSubmit}
        type="button"
      >
        <TextSwap text={label} />
      </button>
    </div>
  );
}

// Figma 5429:37670 — Earn MAX deposit: USDC-only funding from the main
// wallet balance into the RWA Loop strategy. The first deposit also installs
// the Earn MAX policies (that's the rent the caption explains), so submit
// runs install → deposit as two wallet approvals.
export function EarnMaxDepositPane({
  actions,
  data: earnData,
  onBack,
  view,
}: {
  actions: EarnMaxActions;
  data: EarnPositionData;
  onBack: () => void;
  view: EarnMaxViewModel;
}) {
  const { isBalanceHidden } = useBalanceVisibility();
  const [amount, setAmount] = useState("");
  // The funding balance is only auto-refreshed after Earn transactions, so
  // re-read it on open to pick up swaps and external transfers.
  const { refreshMainUsdcAmount } = earnData.actions;
  useEffect(() => {
    void refreshMainUsdcAmount();
  }, [refreshMainUsdcAmount]);

  const sourceUsd = earnData.actions.mainUsdcAmount ?? 0;
  const sourceBalance = splitUsdBalance(sourceUsd);
  const amountUsd = Number.parseFloat(amount.replace(/,/g, "")) || 0;
  const amountLabel = amountUsd.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
  const isBelowMinimum = amountUsd < MIN_DEPOSIT_USD;
  const isInsufficient = !isBelowMinimum && amountUsd > sourceUsd;
  const isValidAmount = !(isBelowMinimum || isInsufficient);
  const isFirstDeposit = view.policyStatus !== "ready";

  const handleAmountChange = (rawValue: string) => {
    const sanitized = sanitizeBucksAmountInput(rawValue, amount);
    if (sanitized !== null) {
      setAmount(sanitized);
    }
  };
  const handleSubmit = async () => {
    const raw = parseUsdcRaw(amount);
    if (!raw || raw <= BigInt(0)) {
      return;
    }
    if (isFirstDeposit && !(await actions.install())) {
      return;
    }
    if (await actions.deposit(raw)) {
      onBack();
    }
  };

  return (
    <>
      <section className="flex h-full min-w-0 flex-1 flex-col overflow-clip rounded-3xl bg-card max-[795px]:rounded-none">
        <ActionHeader onBack={onBack} title="Deposit" />
        <div className="flex min-h-0 w-full flex-1 flex-col">
          <div className="flex w-full flex-1 flex-col">
            <AmountField
              amount={amount}
              isValidAmount={isValidAmount}
              onChange={handleAmountChange}
              onSubmit={() => void handleSubmit()}
            />
            {isFirstDeposit ? (
              <CaptionNote
                text="Your first deposit takes ~0.06 SOL from your wallet for Solana account rent — it is returned when you fully withdraw."
                tone="info"
              />
            ) : null}
          </div>

          <div className="relative flex h-36 w-full flex-col gap-1 p-2">
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
              <span className="flex h-[60px] min-w-0 flex-1 flex-col gap-0.5 py-[9px]">
                <span className="whitespace-nowrap text-[13px] text-muted-foreground leading-4">
                  from USDC balance
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
              <div className="pl-3">
                <button
                  className="t-hover min-w-16 rounded-full bg-accent px-4 py-2.5 text-center font-medium text-[13px] text-foreground leading-4 hover:bg-accent-active"
                  onClick={() => {
                    if (sourceUsd > 0) {
                      // Floor to cents so the fill never rounds above the
                      // real balance, same as the Earn deposit pane's MAX.
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
            </div>

            <div className="flex w-full items-center rounded-2xl px-4">
              <div className="py-2 pr-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-11"
                  src={`${ASSET_BASE}/earn-max-icon.svg`}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 py-2">
                <span className="whitespace-nowrap text-[13px] text-muted-foreground leading-4">
                  to Earn MAX · {EARN_MAX_STRATEGY_NAME}
                </span>
                <span className="flex items-center">
                  <span className="inline-flex items-center rounded-lg bg-positive/[0.14] px-2 py-0.5">
                    <span className="whitespace-nowrap font-medium text-[16px] text-positive leading-5 tracking-[0.06px]">
                      {formatEarnMaxApyLabel(view.forecastApyBps)}
                    </span>
                  </span>
                </span>
              </div>
            </div>

            <div className="absolute top-[calc(50%-2px)] left-[45px] h-3.5 w-0.5 -translate-y-1/2 rounded-xl bg-border" />
          </div>
        </div>

        <SubmitBar
          error={view.error}
          isSubmitting={view.isBusy}
          isValidAmount={isValidAmount}
          label={
            view.isBusy
              ? "Depositing…"
              : isInsufficient
              ? "Insufficient balance"
              : isValidAmount
              ? `Deposit ${amountLabel} USDC`
              : `Minimum deposit is $${MIN_DEPOSIT_USD}`
          }
          onSubmit={() => void handleSubmit()}
        />
      </section>

      {/* The vacated chart column shows the Info & FAQs card (Figma
        5429:37670), same slot the Earn deposit uses for its explainer. */}
      <EarnMaxInfoFaqsCard className="hidden h-full w-[400px] shrink-0 min-[1204px]:flex" />
    </>
  );
}

// Figma 5433:65237 — Earn MAX withdraw: requests an unwind back to the main
// wallet as USDC; funds are claimed from the transaction list once ready.
export function EarnMaxWithdrawPane({
  actions,
  data: earnData,
  onBack,
  view,
}: {
  actions: EarnMaxActions;
  data: EarnPositionData;
  onBack: () => void;
  view: EarnMaxViewModel;
}) {
  const { isBalanceHidden } = useBalanceVisibility();
  const walletData = useWalletDesktopData({});
  const [amount, setAmount] = useState("");

  const balanceUsd = view.balanceUsd;
  const maxFillUsd = Math.floor(balanceUsd * 100) / 100;
  const sourceBalance = splitUsdBalance(balanceUsd);
  const destinationBalance = splitUsdBalance(
    earnData.actions.mainUsdcAmount ?? 0
  );
  const walletAddress = walletData.walletAddress;
  const addressLabel = walletAddress
    ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`
    : "Main";

  const amountUsd = Number.parseFloat(amount.replace(/,/g, "")) || 0;
  const amountLabel = amountUsd.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
  // One unwind at a time — the strategy queues a single withdrawal request.
  const hasPendingWithdrawal =
    view.withdrawal !== null && view.withdrawal.status !== "claimed";
  const isInsufficient = amountUsd > balanceUsd;
  const isValidAmount =
    amountUsd > 0 && !isInsufficient && !hasPendingWithdrawal;

  const handleAmountChange = (rawValue: string) => {
    const sanitized = sanitizeBucksAmountInput(rawValue, amount);
    if (sanitized !== null) {
      setAmount(sanitized);
    }
  };
  const handleSubmit = async () => {
    // A cent-floored full fill means "everything" — send max so dust and
    // accrued yield unwind too.
    const useMax = amountUsd >= maxFillUsd && maxFillUsd > 0;
    const raw = parseUsdcRaw(amount);
    if (!useMax && (!raw || raw <= BigInt(0))) {
      return;
    }
    if (await actions.requestWithdrawal(useMax ? "max" : raw!)) {
      onBack();
    }
  };

  return (
    <>
      <section className="flex h-full min-w-0 flex-1 flex-col overflow-clip rounded-3xl bg-card max-[795px]:rounded-none">
        <ActionHeader onBack={onBack} title="Withdraw" />
      <div className="flex min-h-0 w-full flex-1 flex-col">
        <div className="flex w-full flex-1 flex-col">
          <AmountField
            amount={amount}
            isValidAmount={isValidAmount}
            onChange={handleAmountChange}
            onSubmit={() => void handleSubmit()}
          />
          <CaptionNote
            text="Withdrawals take up to 5 minutes to process. Once ready, you'll need to claim your funds from the transaction list."
            tone="warn"
          />
        </div>

        <div className="relative flex h-36 w-full flex-col gap-1 p-2">
          <div className="flex w-full items-center rounded-2xl px-4">
            <div className="py-2 pr-3">
              <EarnMaxDualIcon isWithdraw />
            </div>
            <span className="flex h-[60px] min-w-0 flex-1 flex-col gap-0.5 py-[9px]">
              <span className="whitespace-nowrap text-[13px] text-muted-foreground leading-4">
                from {EARN_MAX_STRATEGY_NAME} USDC
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
            <div className="pl-3">
              <button
                className="t-hover min-w-16 rounded-full bg-accent px-4 py-2.5 text-center font-medium text-[13px] text-foreground leading-4 hover:bg-accent-active"
                onClick={() => {
                  if (maxFillUsd > 0) {
                    handleAmountChange(maxFillUsd.toFixed(2));
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
                src={`${ASSET_BASE}/stablecoins-icon.svg`}
              />
            </div>
            <span className="flex h-[60px] min-w-0 flex-1 flex-col gap-0.5 py-[9px]">
              <span className="whitespace-nowrap text-[13px] text-muted-foreground leading-4">
                to Stablecoins · {addressLabel}
              </span>
              <span className="whitespace-nowrap font-semibold text-[20px] text-foreground leading-6">
                <ScrambleText
                  isHidden={isBalanceHidden}
                  text={destinationBalance.balanceWhole}
                />
                <span className="text-tertiary">
                  <ScrambleText
                    isHidden={isBalanceHidden}
                    text={destinationBalance.balanceFraction}
                  />
                </span>
              </span>
            </span>
          </div>

          <div className="absolute top-[calc(50%-2px)] left-[45px] h-3.5 w-0.5 -translate-y-1/2 rounded-xl bg-border" />
        </div>
      </div>

      <SubmitBar
        error={view.error}
        isSubmitting={view.isBusy}
        isValidAmount={isValidAmount}
        label={
          view.isBusy
            ? "Requesting withdrawal…"
            : hasPendingWithdrawal
            ? "A withdrawal is already in progress"
            : isInsufficient
            ? "Insufficient balance"
            : isValidAmount
            ? `Withdraw ${amountLabel} USDC`
            : "Enter amount"
        }
        onSubmit={() => void handleSubmit()}
      />
      </section>

      {/* Same vacated-chart-column card the deposit screen shows (the
        design's withdraw frame carries the identical 400px right panel,
        node 5433:65287). */}
      <EarnMaxInfoFaqsCard className="hidden h-full w-[400px] shrink-0 min-[1204px]:flex" />
    </>
  );
}
