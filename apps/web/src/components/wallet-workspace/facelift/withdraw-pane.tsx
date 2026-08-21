"use client";

import {
  CircleDollarSign,
  Landmark,
  PenLine,
  Undo2,
  Wallet,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import {
  deriveEarnWithdrawMode,
  type EarnWithdrawDraft,
  type EarnWithdrawSourceOption,
  sanitizeBucksAmountInput,
} from "@/components/wallet-sidebar/earn-detail-view";
import {
  maskBalanceText,
  ScrambleText,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { DropdownReveal } from "@/components/wallet-workspace/facelift/dropdown-reveal";
import {
  DualIcon,
  resolveEarnCoinIconSrc,
} from "@/components/wallet-workspace/facelift/earn-activity-card";
import {
  FlowDiagram,
  FlowExplainerAside,
  FlowExplainerOverlay,
  type FlowStep,
} from "@/components/wallet-workspace/facelift/flow-explainer";
import { SheetReveal } from "@/components/wallet-workspace/facelift/sheet-reveal";
import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import type { EarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import { useStablecoinsUsd } from "@/components/wallet-workspace/facelift/use-stablecoins-usd";
import { splitUsdBalance } from "@/hooks/use-wallet-desktop-data";
import {
  resolveEarnPositionDisplay,
  resolveEarnTransactionMarketIcon,
} from "@/lib/yield-optimization/earn-position-display";

const ASSET_BASE = "/wallet-workspace/facelift";

// The exit path told as steps — the same route the deposit explainer walks,
// run backwards from lending market through the vault to Main Account,
// ending on the rent-cleanup phase after a full exit.
function createWithdrawSteps(symbol: string): readonly FlowStep[] {
  return [
    {
      Icon: Landmark,
      body: `Every Kamino ${symbol} reserve you supplied, plus anything still idle in your Earn vault, is listed with its own balance.`,
      title: "Pick a position",
    },
    {
      Icon: CircleDollarSign,
      body: "Take part of it, or use Max to exit that position completely. There is no lock-up.",
      title: "Choose an amount",
    },
    {
      Icon: PenLine,
      body: "One signature moves the funds through your own smart account — Loyal never takes custody of your funds.",
      title: "Approve in your wallet",
    },
    {
      Icon: Wallet,
      body: `It leaves the lending market, passes back through your Earn vault, and lands in your stablecoins. ${symbol} stays ${symbol} — it is never swapped.`,
      title: `${symbol} returns to your wallet`,
    },
    {
      Icon: Undo2,
      body: "Once a position is empty, close its Earn accounts to reclaim the SOL held as their rent.",
      title: "A full exit frees the rent",
    },
  ];
}

const WITHDRAW_FOOTNOTE =
  "Market liquidity can affect how quickly a withdrawal completes. Interest accrues until the moment funds leave the market.";

const WITHDRAW_DOCS_URL =
  "https://docs.askloyal.com/automations/exit-and-lifecycle";

// Display label matching the facelift rows: "Main Kamino USDC" for reserves
// (the OG source label is "<market> reserve"), the OG label for idle vaults.
function sourceDisplayLabel(source: EarnWithdrawSourceOption) {
  const symbol = resolveEarnPositionDisplay({
    liquidityMint: source.liquidityMint,
    market: source.market,
  }).mintSymbol;
  return source.type === "reserve"
    ? `${source.label.replace(/ reserve$/, "")} ${symbol}`
    : `Idle vault ${symbol}`;
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
  // $0.00 dust cannot be withdrawn on its own (Max-exit cleanup collects
  // it) — the row stays listed but is not selectable.
  const isDust = option.usd < 0.005;
  return (
    <button
      className={`t-hover flex w-full items-center px-4 text-left disabled:opacity-40 enabled:hover:bg-accent ${rounded}`}
      disabled={isDust}
      onClick={onSelect}
      type="button"
    >
      <span className="flex items-center py-2 pr-3">{option.icon}</span>
      <span className="flex h-[60px] min-w-0 flex-1 flex-col gap-0.5 py-[9px]">
        <span className="whitespace-nowrap text-[13px] text-muted-foreground leading-4">
          {option.label}
        </span>
        <span className="whitespace-nowrap font-semibold text-[20px] text-foreground leading-6">
          <ScrambleText isHidden={isBalanceHidden} text={amount.balanceWhole} />
          <span className="text-tertiary">
            <ScrambleText
              isHidden={isBalanceHidden}
              text={amount.balanceFraction}
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

// Figma 4693:66727 (positions pane, empty amount) + 4693:66028 (valid amount)
// + 4693:66297 (source select opens as an anchored dropdown action-sheet).
// Renders the middle Withdraw card at its usual width (the "How Withdraw
// works" explainer holds the right slot) with the position select opening
// in-pane at every desktop width (bottom sheet on mobile). Withdrawals run
// through data.actions (OG protocol); after a full exit the pane flips into
// the rent-cleanup phase ("Close policies").
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
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const { isBalanceHidden } = useBalanceVisibility();

  const stablecoinsUsd = useStablecoinsUsd();
  const stablecoinsBalance = splitUsdBalance(stablecoinsUsd);
  const addressLabel = data.walletAddress
    ? `${data.walletAddress.slice(0, 4)}…${data.walletAddress.slice(-4)}`
    : "";

  // Every positive idle or reserve holding is an independently selectable
  // withdrawal source, matching the old workspace's withdraw view.
  const sources = data.actions.withdrawSources;
  const options = useMemo<WithdrawSourceOption[]>(
    () =>
      sources.map((source) => ({
        icon: (
          <DualIcon
            backSrc={resolveEarnCoinIconSrc({
              liquidityMint: source.liquidityMint,
              market: source.market,
            })}
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
  // The selector opens upward from the trigger, so withdrawable sources sit
  // at the bottom (nearest the trigger) and $0.00 dust at the top — same
  // contract as the deposit source selector.
  const listedOptions = useMemo(
    () =>
      [...options].sort(
        (a, b) => (a.usd >= 0.005 ? 1 : 0) - (b.usd >= 0.005 ? 1 : 0)
      ),
    [options]
  );
  // Null while no sources exist (cleanup-only phase after a full exit).
  // The fallback prefers a withdrawable source over $0.00 dust.
  const selectedOption =
    options.find((option) => option.key === selectedKey) ??
    options.find((option) => option.usd >= 0.005) ??
    options[0] ??
    null;
  const fromBalance = splitUsdBalance(selectedOption?.usd ?? 0);

  const amountUsd = Number.parseFloat(amount.replace(/,/g, "")) || 0;
  const amountLabel = amountUsd.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
  // Same mode derivation as the old workspace: compared against the floored
  // TOTAL of all sources, so the visible max registers as a full exit.
  const withdrawMode = deriveEarnWithdrawMode({ amount: amountUsd, sources });
  const fullExitSources = useMemo(
    () => sources.filter((source) => source.type === "reserve"),
    [sources]
  );
  // A picked row maps 1:1 to its source, same as the OG picker.
  const draftSource = selectedOption?.source ?? null;
  const selectedSymbol = draftSource
    ? resolveEarnPositionDisplay({
        liquidityMint: draftSource.liquidityMint,
        market: draftSource.market,
      }).mintSymbol
    : "stablecoin";
  const withdrawSteps = useMemo(
    () => createWithdrawSteps(selectedSymbol),
    [selectedSymbol]
  );
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
      symbol: selectedSymbol,
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
              Withdraw
            </h1>
            <button
              aria-label="How Withdraw works"
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
                      if (canWithdraw && !isSubmitting) {
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
          </div>

          <div className="relative flex h-36 w-full flex-col gap-1 p-2">
            {isSheetOpen ? (
              <button
                aria-label="Close position select"
                className="fixed inset-0 z-10 cursor-default max-[795px]:hidden"
                onClick={() => setIsSheetOpen(false)}
                type="button"
              />
            ) : null}
            <DropdownReveal
              className="absolute inset-x-2 bottom-full z-20 flex flex-col rounded-2xl bg-popover/70 p-2 shadow-[0px_0px_2px_0px_rgba(0,0,0,0.08),0px_4px_16px_0px_rgba(0,0,0,0.08)] backdrop-blur-[16px] max-[795px]:hidden"
              isOpen={isSheetOpen}
              origin="bottom-center"
            >
              {listedOptions.map((option) => (
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
              sheetClassName="flex w-full flex-col rounded-t-3xl bg-card shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
            >
              <header className="flex w-full items-center p-2">
                <h2 className="min-w-0 flex-1 truncate py-2.5 pl-2 font-semibold text-[20px] text-foreground leading-6">
                  Positions
                </h2>
                <button
                  aria-label="Close position select"
                  className="t-hover flex size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-accent"
                  onClick={() => setIsSheetOpen(false)}
                  type="button"
                >
                  <ThemedIcon
                    className="size-6 text-muted-foreground"
                    src={`${ASSET_BASE}/icon-cross.svg`}
                  />
                </button>
              </header>
              <div className="flex w-full flex-col py-2">
                {listedOptions.map((option) => (
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
                isSheetOpen ? "bg-accent" : ""
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
                  <span className="whitespace-nowrap text-[13px] text-muted-foreground leading-4">
                    <TextSwap
                      text={`from ${selectedOption?.label ?? "Earn"}`}
                    />
                  </span>
                  <span className="whitespace-nowrap font-semibold text-[20px] text-foreground leading-6">
                    {/* Hiding masks through TextSwap's own swap animation
                        (churning it would thrash the swap). */}
                    <TextSwap
                      text={
                        isBalanceHidden
                          ? maskBalanceText(fromBalance.balanceWhole, "whole")
                          : fromBalance.balanceWhole
                      }
                    />
                    <span className="text-tertiary">
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
                  className="t-hover min-w-16 rounded-full bg-accent px-4 py-2.5 text-center font-medium text-[13px] text-foreground leading-4 hover:bg-accent-active"
                  onClick={() => {
                    const usd = selectedOption?.usd ?? 0;
                    if (usd > 0) {
                      // Floor to cents so the label never rounds above the
                      // real balance (full exits withdraw the exact raw).
                      // Sub-cent dust floors to $0.00 and blocks the exit;
                      // use the exact 6-decimal amount so the position can
                      // still close (ASK-2207).
                      const floored = Math.floor(usd * 100) / 100;
                      handleAmountChange(
                        floored > 0 ? floored.toFixed(2) : usd.toFixed(6)
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
                className="t-hover -my-2.5 -mr-2.5 ml-0.5 flex size-11 items-center justify-center rounded-3xl hover:bg-accent"
                onClick={() => setIsSheetOpen((open) => !open)}
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
                  src={`${ASSET_BASE}/stablecoins-icon.svg`}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 py-2">
                <span className="truncate text-[13px] text-muted-foreground leading-4">
                  {`to Stablecoins · ${addressLabel}`}
                </span>
                <p className="whitespace-nowrap font-semibold text-[20px] text-foreground leading-6">
                  <ScrambleText
                    isHidden={isBalanceHidden}
                    text={stablecoinsBalance.balanceWhole}
                  />
                  <span className="text-tertiary">
                    <ScrambleText
                      isHidden={isBalanceHidden}
                      text={stablecoinsBalance.balanceFraction}
                    />
                  </span>
                </p>
              </div>
            </div>

            <div className="absolute top-[calc(50%-2px)] left-[45px] h-3.5 w-0.5 -translate-y-1/2 rounded-xl bg-border" />
          </div>
        </div>

        <div className="w-full bg-card px-4 pt-2 pb-4">
          {data.actions.withdrawError ? (
            <p className="px-4 pb-2 text-[13px] text-destructive leading-4">
              {data.actions.withdrawError}
            </p>
          ) : null}
          {isCleanupOnly ? (
            <>
              {/* Phase 2 of a full exit (slot-pinned zero proof happens
                  server-side in the prepare): close the empty Earn accounts
                  and reclaim their SOL rent. */}
              <p className="px-4 pb-2 text-[13px] text-muted-foreground leading-4">
                Your funds are withdrawn. Close the empty Earn accounts to
                reclaim their SOL rent.
              </p>
              <button
                className="t-hover flex h-12 w-full items-center justify-center rounded-full bg-foreground font-medium text-[16px] text-background leading-5 enabled:active:translate-y-0 enabled:hover:-translate-y-0.5 enabled:hover:bg-foreground/90"
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
                  ? "bg-foreground text-background enabled:active:translate-y-0 enabled:hover:-translate-y-0.5 enabled:hover:bg-foreground/90"
                  : "bg-destructive/[0.08] text-destructive"
              }`}
              disabled={!canWithdraw || isSubmitting}
              onClick={() => void handleSubmit()}
              type="button"
            >
              <TextSwap
                text={
                  isSubmitting
                    ? "Withdrawing…"
                    : withdrawValidationError ??
                      `Withdraw ${amountLabel} ${selectedSymbol}`
                }
              />
            </button>
          )}
        </div>
      </section>

      {/* Explainer fills the slot the positions column vacated (the shell
        renders no chart pane here), so the middle pane keeps its usual
        width; overlay via the header ? below 1204px — same split Deposit
        and Autodeposit use. */}
      <FlowExplainerAside title="How Withdraw works">
        <FlowDiagram
          docsHref={WITHDRAW_DOCS_URL}
          footnote={WITHDRAW_FOOTNOTE}
          steps={withdrawSteps}
        />
      </FlowExplainerAside>

      <FlowExplainerOverlay
        isOpen={isInfoOpen}
        onClose={() => setIsInfoOpen(false)}
        title="How Withdraw works"
      >
        <FlowDiagram
          docsHref={WITHDRAW_DOCS_URL}
          footnote={WITHDRAW_FOOTNOTE}
          steps={withdrawSteps}
        />
      </FlowExplainerOverlay>
    </>
  );
}
