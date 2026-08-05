"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { sanitizeBucksAmountInput } from "@/components/wallet-sidebar/earn-detail-view";
import {
  formatShieldAmountInputValue,
  isShieldAmountOverBalance,
} from "@/components/wallet-sidebar/shield-amount";
import type { SwapToken } from "@/components/wallet-sidebar/types";
import {
  ActionErrorBody,
  ActionProcessingBody,
  ActionSuccessBody,
  formatTokenAmount,
  formatUsdAmount,
  SOL_FEE_RESERVE,
} from "@/components/wallet-workspace/facelift/action-screens";
import {
  ScrambleText,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { PaneReveal } from "@/components/wallet-workspace/facelift/pane-transitions";
import { SheetReveal } from "@/components/wallet-workspace/facelift/sheet-reveal";
import { SplitAmount } from "@/components/wallet-workspace/facelift/sidebar";
import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import { useShield } from "@/hooks/use-shield";
import { splitUsdBalance } from "@/hooks/use-wallet-desktop-data";
import { getTokenIconUrl } from "@/lib/token-icon";

const ASSET_BASE = "/wallet-workspace/facelift";

type ShieldDirection = "shield" | "unshield";

// Shield screen (Figma 4822:416013): one amount form whose direction follows
// the selected asset — a public token shields, a shielded one unshields.
// Execution is the OG ShieldContent flow on useShield (MAX keeps the OG
// SOL fee reserve when shielding; unshield MAX carries the isMax flag so the
// vault drains its epsilon). Confirm walks the shared step screens:
// processing (4822:422952 / 4822:423983) → success or error (same as swap).
export function ShieldPane({
  onBack,
  onDone,
  onFormActiveChange,
  onOpenInfo,
  onOpenSelect,
  onSuccess,
  token,
}: {
  onBack: () => void;
  onDone: () => void;
  onFormActiveChange?: (isFormActive: boolean) => void;
  onOpenInfo: () => void;
  onOpenSelect: () => void;
  onSuccess: () => void;
  token: SwapToken;
}) {
  const { executeShield, executeUnshield } = useShield();
  const { isBalanceHidden } = useBalanceVisibility();
  const direction: ShieldDirection = token.isSecured ? "unshield" : "shield";

  const [amountInput, setAmountInput] = useState("");
  const [isUsdInput, setIsUsdInput] = useState(false);
  // MAX on an unshield drains the vault epsilon server-side — manual edits
  // and asset switches drop the flag.
  const [isMaxSelected, setIsMaxSelected] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "processing" | "success" | "error">(
    "form"
  );
  const [txSignature, setTxSignature] = useState<string | null>(null);
  // The direction the in-flight submit ran with — the selector stays live, so
  // the result screens must not re-derive from the current token.
  const [submittedDirection, setSubmittedDirection] =
    useState<ShieldDirection>(direction);

  useEffect(() => {
    setIsMaxSelected(false);
  }, [token.mint, token.isSecured]);

  // The asset selector only makes sense against the form — the parent hides
  // its panes while a submit is in flight or a result screen is up.
  useEffect(() => {
    onFormActiveChange?.(step === "form");
  }, [step, onFormActiveChange]);

  const numericInput = Number.parseFloat(amountInput.replace(/,/g, "")) || 0;
  const tokenAmount = isUsdInput
    ? token.price > 0
      ? numericInput / token.price
      : 0
    : numericInput;
  const usdAmount = tokenAmount * token.price;
  const hasAmount = tokenAmount > 0;
  const insufficientFunds = useMemo(
    () =>
      isShieldAmountOverBalance({
        amount: tokenAmount,
        sourceBalance: token.balance,
        tokenSymbol: token.symbol,
      }),
    [token.balance, token.symbol, tokenAmount]
  );

  const handleAmountChange = (rawValue: string) => {
    const sanitized = sanitizeBucksAmountInput(rawValue, amountInput);
    if (sanitized !== null) {
      setAmountInput(sanitized);
      setIsMaxSelected(false);
      setErrorMessage(null);
    }
  };

  const handleToggleCurrency = () => {
    if (numericInput > 0 && token.price > 0) {
      setAmountInput(
        isUsdInput
          ? String(Number(tokenAmount.toFixed(6)))
          : String(Number(usdAmount.toFixed(2)))
      );
    }
    setIsUsdInput(!isUsdInput);
  };

  const handleMax = () => {
    let value = token.balance;
    if (direction === "shield" && token.symbol.toUpperCase() === "SOL") {
      value = Math.max(0, value - SOL_FEE_RESERVE);
    }
    if (value <= 0) {
      setAmountInput("");
      setIsMaxSelected(false);
      return;
    }
    setIsMaxSelected(true);
    setAmountInput(
      isUsdInput
        ? String(Number((value * token.price).toFixed(2)))
        : formatShieldAmountInputValue(value, token.symbol)
    );
  };

  const handleConfirm = async () => {
    if (!hasAmount || insufficientFunds || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    setTxSignature(null);
    setSubmittedDirection(direction);
    setStep("processing");
    const params = {
      tokenSymbol: token.symbol,
      amount: tokenAmount,
      tokenMint: token.mint,
    };
    const result =
      direction === "shield"
        ? await executeShield({
            ...params,
            successTrackingProperties: {
              token_symbol: token.symbol,
              token_mint: token.mint,
              amount: String(tokenAmount),
              usd_value: `$${formatUsdAmount(usdAmount)}`,
              direction,
            },
          })
        : await executeUnshield({ ...params, isMax: isMaxSelected });
    setIsSubmitting(false);
    if (result.success) {
      setTxSignature(result.signature ?? null);
      setAmountInput("");
      setIsMaxSelected(false);
      onSuccess();
      setStep("success");
      return;
    }
    setErrorMessage(
      result.error ??
        `${
          direction === "shield" ? "Shield" : "Unshield"
        } failed. Please try again.`
    );
    setStep("error");
  };

  const ctaLabel = !hasAmount
    ? "Enter amount"
    : insufficientFunds
    ? "Insufficient balance"
    : direction === "shield"
    ? "Shield"
    : "Unshield";
  const isCtaInvalid = !hasAmount || insufficientFunds;
  const ctaDisabled = isCtaInvalid || isSubmitting;

  const balanceSplit = splitUsdBalance(token.balance * token.price);
  // Mirrors the design's shield-mode caption for the opposite direction.
  const captionText =
    direction === "shield"
      ? "To unshield funds, select a shielded asset"
      : "To shield funds, select an unshielded asset";

  return (
    /* The result screens unclip the pane on desktop so their dog can drop
        into the shell's 8px gap and sit flush with the viewport bottom (same
        escape the earn empty pane uses); the form keeps the clip. */
    <section
      className={`flex h-full w-full min-w-0 flex-1 flex-col rounded-3xl bg-white max-[795px]:rounded-none ${
        step === "success" || step === "error"
          ? "max-[795px]:overflow-clip"
          : "overflow-clip"
      }`}
    >
      <header className="flex w-full shrink-0 items-center p-2">
        <div className="flex shrink-0 items-center pr-3">
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
        <div className="flex min-w-0 flex-1 items-center gap-2 py-2">
          <h1 className="truncate whitespace-nowrap font-semibold text-[20px] text-black leading-6">
            <TextSwap text={direction === "shield" ? "Shield" : "Unshield"} />
          </h1>
          <button
            aria-label="What are Shielded Assets?"
            className="t-hover -m-2.5 flex size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-black/[0.04]"
            onClick={onOpenInfo}
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
      </header>

      <PaneReveal key={step}>
        {step === "form" ? (
          <>
            <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto">
              <div className="w-full shrink-0 p-2">
                <div className="flex w-full flex-col gap-0.5 px-4 py-2">
                  <p className="whitespace-nowrap text-[16px] leading-5 text-[rgba(60,60,67,0.6)]">
                    Amount
                  </p>
                  <div className="flex w-full items-center">
                    <div className="flex h-12 min-w-0 flex-1 items-baseline">
                      {isUsdInput ? (
                        <span className="font-semibold text-[40px] text-black leading-[48px]">
                          $
                        </span>
                      ) : null}
                      <input
                        autoFocus
                        className="w-full min-w-0 bg-transparent font-semibold text-[40px] text-black leading-[48px] outline-none placeholder:text-[#b1b1b4]"
                        inputMode="decimal"
                        onChange={(event) =>
                          handleAmountChange(event.target.value)
                        }
                        placeholder="0"
                        type="text"
                        value={amountInput}
                      />
                    </div>
                    <div className="flex shrink-0 items-center pl-3">
                      <button
                        aria-label="Switch between token and dollar amounts"
                        className="t-hover flex size-11 items-center justify-center rounded-3xl hover:bg-black/[0.04]"
                        onClick={handleToggleCurrency}
                        type="button"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          alt=""
                          aria-hidden="true"
                          className="size-6"
                          src={`${ASSET_BASE}/icon-arrow-top-bottom.svg`}
                        />
                      </button>
                    </div>
                  </div>
                  <p className="whitespace-nowrap text-[16px] leading-5 text-[rgba(60,60,67,0.6)]">
                    {isUsdInput
                      ? `${formatTokenAmount(tokenAmount)} ${token.symbol}`
                      : `$${formatUsdAmount(usdAmount)}`}
                  </p>
                </div>
              </div>
              <div className="w-full shrink-0 px-2">
                <div className="flex w-full items-start px-4">
                  <span className="flex shrink-0 items-center py-1 pr-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt=""
                      aria-hidden="true"
                      className="size-6"
                      src={`${ASSET_BASE}/icon-circle-info.svg`}
                    />
                  </span>
                  <p className="min-w-0 max-w-[400px] flex-1 py-2 text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
                    <TextSwap text={captionText} />
                  </p>
                </div>
              </div>

              {/* Source asset cell pinned above the CTA; below 1204px tapping
                  it opens the selector overlay (the aside is hidden there). */}
              <div className="mt-auto w-full shrink-0 p-2">
                <div className="flex w-full items-center px-4">
                  <button
                    className="flex min-w-0 flex-1 items-center text-left min-[1204px]:pointer-events-none"
                    onClick={onOpenSelect}
                    type="button"
                  >
                    <span className="flex shrink-0 items-center py-2 pr-3">
                      <span className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          alt=""
                          className="block size-11 rounded-full object-cover"
                          src={token.icon || getTokenIconUrl(token.symbol)}
                        />
                        {token.isSecured ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            alt="Shielded"
                            className="-bottom-0.5 -right-[3px] absolute size-5"
                            src={`${ASSET_BASE}/icon-shield-badge.svg`}
                          />
                        ) : null}
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1 py-2">
                      <SplitAmount
                        fraction={balanceSplit.balanceFraction}
                        fractionColor="#b1b1b4"
                        isHidden={isBalanceHidden}
                        isRevealed
                        whole={balanceSplit.balanceWhole}
                      />
                      <span className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
                        <ScrambleText
                          isHidden={isBalanceHidden}
                          text={`${formatTokenAmount(token.balance)} ${
                            token.symbol
                          }`}
                        />
                      </span>
                    </span>
                  </button>
                  <span className="flex shrink-0 items-center pl-3">
                    <button
                      className="t-hover flex min-w-16 items-center justify-center rounded-full bg-black/[0.04] px-4 py-2.5 font-medium text-[13px] text-black leading-4 hover:bg-black/[0.08]"
                      onClick={handleMax}
                      type="button"
                    >
                      MAX
                    </button>
                  </span>
                </div>
              </div>
            </div>

            <div className="w-full shrink-0 bg-white px-4 pt-2 pb-4">
              <button
                className={`flex h-12 w-full items-center justify-center rounded-full font-medium text-[16px] leading-5 transition-colors ${
                  isCtaInvalid
                    ? "bg-[rgba(249,54,60,0.08)] text-[#f9363c]"
                    : ctaDisabled
                    ? "bg-black text-white opacity-60"
                    : "t-hover bg-black text-white hover:-translate-y-0.5 hover:bg-[#171717] active:translate-y-0"
                }`}
                disabled={ctaDisabled}
                onClick={() => void handleConfirm()}
                type="button"
              >
                <TextSwap text={ctaLabel} />
              </button>
            </div>
          </>
        ) : step === "processing" ? (
          <ActionProcessingBody
            icons={
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className="-mr-4 size-16 rounded-full object-cover"
                  src={token.icon || getTokenIconUrl(token.symbol)}
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt=""
                  aria-hidden="true"
                  className="h-16 w-auto max-w-none"
                  src={`${ASSET_BASE}/${
                    submittedDirection === "shield"
                      ? "icon-shield-red-64.svg"
                      : "icon-shield-break-64.svg"
                  }`}
                />
              </>
            }
            label={
              submittedDirection === "shield" ? "Shielding" : "Unshielding"
            }
          />
        ) : step === "success" ? (
          <ActionSuccessBody
            label={submittedDirection === "shield" ? "Shielded" : "Unshielded"}
            onDone={onDone}
            signature={txSignature}
            source="shield_success"
          />
        ) : (
          <ActionErrorBody
            message={errorMessage}
            onBack={() => {
              setErrorMessage(null);
              setStep("form");
            }}
          />
        )}
      </PaneReveal>
    </section>
  );
}

// "Select asset" pane (Figma 4822:417305): the shield screen's permanent
// right pane — public and shielded holdings in one list, the current source
// highlighted. Local filter only (held assets, no remote search). onClose is
// passed only by the <1204 overlay, which needs its own dismiss.
export function ShieldAssetPane({
  nameByMint,
  onClose,
  onSelect,
  selectedToken,
  tokens,
}: {
  nameByMint: Record<string, string>;
  onClose?: () => void;
  onSelect: (token: SwapToken) => void;
  selectedToken: SwapToken;
  tokens: SwapToken[];
}) {
  const { isBalanceHidden } = useBalanceVisibility();
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      tokens.filter((token) => {
        if (!query) {
          return true;
        }
        const name = token.mint ? nameByMint[token.mint] : undefined;
        return (
          token.symbol.toLowerCase().includes(query) ||
          (name?.toLowerCase().includes(query) ?? false) ||
          token.mint?.toLowerCase() === query
        );
      }),
    [nameByMint, query, tokens]
  );

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <header className="flex w-full shrink-0 items-center p-2">
        <div className="flex min-w-0 flex-1 items-center py-2.5 pl-4 max-[795px]:pl-2">
          <h2 className="truncate whitespace-nowrap font-semibold text-[20px] text-black leading-6">
            Select asset
          </h2>
        </div>
        {onClose ? (
          <div className="flex shrink-0 items-center pl-3">
            <button
              aria-label="Close"
              className="t-hover flex size-11 items-center justify-center rounded-3xl hover:bg-black/[0.04]"
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
          </div>
        ) : null}
      </header>
      <div className="w-full shrink-0 px-4 pb-2">
        <div className="flex w-full items-center rounded-full bg-black/[0.04] px-3">
          <Search
            className="mr-3 shrink-0 text-[#8a8a8e]"
            size={24}
            strokeWidth={2}
          />
          <input
            className="min-w-0 flex-1 bg-transparent py-3 text-[16px] text-black leading-5 outline-none placeholder:text-[#8a8a8e]"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search assets"
            type="text"
            value={search}
          />
        </div>
      </div>
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-[14px] leading-5 text-[rgba(60,60,67,0.6)]">
            No assets found
          </p>
        ) : (
          filtered.map((token) => {
            const isSelected =
              token.mint === selectedToken.mint &&
              !!token.isSecured === !!selectedToken.isSecured;
            const split = splitUsdBalance(token.balance * token.price);
            return (
              <button
                className={`t-hover flex w-full shrink-0 items-center rounded-2xl px-4 text-left ${
                  isSelected ? "bg-black/[0.04]" : "hover:bg-black/[0.04]"
                }`}
                key={`${token.mint ?? token.symbol}${
                  token.isSecured ? "-secured" : ""
                }`}
                onClick={() => onSelect(token)}
                type="button"
              >
                <span className="flex shrink-0 items-center py-2 pr-3">
                  <span className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt=""
                      className="block size-11 rounded-full object-cover"
                      src={token.icon || getTokenIconUrl(token.symbol)}
                    />
                    {token.isSecured ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt="Shielded"
                        className="-bottom-0.5 -right-[3px] absolute size-5"
                        src={`${ASSET_BASE}/icon-shield-badge.svg`}
                      />
                    ) : null}
                  </span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
                  <span className="truncate font-medium text-[16px] text-black leading-5 tracking-[-0.176px]">
                    {(token.mint ? nameByMint[token.mint] : undefined) ??
                      token.symbol}
                    {token.isSecured ? (
                      <span className="text-[#b1b1b4]"> · Shielded</span>
                    ) : null}
                  </span>
                  <span className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
                    {token.symbol}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5 py-[11px] pl-3">
                  <span className="whitespace-nowrap text-right font-medium text-[16px] text-black leading-5">
                    {isBalanceHidden ? (
                      <ScrambleText
                        isHidden
                        text={`${split.balanceWhole}${split.balanceFraction}`}
                      />
                    ) : (
                      <>
                        {split.balanceWhole}
                        <span className="text-[#b1b1b4]">
                          {split.balanceFraction}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="whitespace-nowrap text-right text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
                    <ScrambleText
                      isHidden={isBalanceHidden}
                      text={formatTokenAmount(token.balance)}
                    />
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// "What are Shielded Assets?" (Figma 4822:420519): the shield screen's right
// pane is taken by the asset selector, so — unlike autodeposit's wide
// layout — the info card overlays at every width; mobile gets the bottom
// sheet like the other facelift sheets.
export function ShieldInfoOverlay({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <SheetReveal
      isOpen={isOpen}
      onClose={onClose}
      scrimClassName="fixed inset-0 z-50 flex bg-black/20 p-2 backdrop-blur-[4px] max-[795px]:bg-white/60 max-[795px]:p-0 max-[795px]:pt-8"
      sheetClassName="ml-auto flex h-full w-[400px] min-w-0 max-w-full flex-col overflow-clip rounded-3xl bg-white max-[795px]:w-full max-[795px]:rounded-b-none max-[795px]:shadow-[0px_-10px_40px_-10px_rgba(0,0,0,0.2)]"
    >
      <header className="flex w-full items-center p-2">
        <h2 className="min-w-0 flex-1 truncate py-2.5 pl-4 font-semibold text-[20px] text-black leading-6">
          What are Shielded Assets?
        </h2>
        <button
          aria-label="Close info"
          className="t-hover flex size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-black/[0.04]"
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
      <div className="flex min-h-0 w-full flex-1 items-center justify-center p-2">
        {/* ponytail: the design's info body is still a placeholder — swap in
            real copy when it lands in Figma. */}
        <p className="text-center text-[16px] leading-5 text-[#8a8a8e]">
          Content
        </p>
      </div>
      <div className="w-full px-4 pt-2 pb-4 min-[796px]:hidden">
        <button
          className="t-hover flex h-12 w-full items-center justify-center rounded-full bg-[#f5f5f5] font-medium text-[16px] text-black leading-5 hover:bg-[#ececec]"
          onClick={onClose}
          type="button"
        >
          Close
        </button>
      </div>
    </SheetReveal>
  );
}
