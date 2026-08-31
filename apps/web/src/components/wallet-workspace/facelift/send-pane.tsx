"use client";

import { CircleX, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { sanitizeBucksAmountInput } from "@/components/wallet-sidebar/earn-detail-view";
import {
  isValidSolanaAddress,
  truncateAddress,
} from "@/components/wallet-sidebar/send-content";
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
import { SplitAmount } from "@/components/wallet-workspace/facelift/sidebar";
import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import { useSend } from "@/hooks/use-send";
import { splitUsdBalance } from "@/hooks/use-wallet-desktop-data";
import { getTokenIconUrl } from "@/lib/token-icon";

const ASSET_BASE = "/wallet-workspace/facelift";

// --- Recently used recipients ------------------------------------------------
// The design's "Recently used" list has no backend; a per-wallet localStorage
// list (most recent first, with a send counter) covers it.

export type SendRecentRecipient = {
  address: string;
  count: number;
  lastUsedAt: number;
};

const RECENTS_LIMIT = 5;

function recentsStorageKey(walletAddress: string | null): string {
  return `loyal:send-recents:${walletAddress ?? "anon"}`;
}

export function useSendRecentRecipients(walletAddress: string | null): {
  recents: SendRecentRecipient[];
  recordSend: (address: string) => void;
} {
  const [recents, setRecents] = useState<SendRecentRecipient[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(recentsStorageKey(walletAddress));
      setRecents(raw ? (JSON.parse(raw) as SendRecentRecipient[]) : []);
    } catch {
      setRecents([]);
    }
  }, [walletAddress]);

  const recordSend = useCallback(
    (address: string) => {
      setRecents((current) => {
        const existing = current.find((entry) => entry.address === address);
        const next = [
          {
            address,
            count: (existing?.count ?? 0) + 1,
            lastUsedAt: Date.now(),
          },
          ...current.filter((entry) => entry.address !== address),
        ].slice(0, RECENTS_LIMIT);
        try {
          localStorage.setItem(
            recentsStorageKey(walletAddress),
            JSON.stringify(next)
          );
        } catch {
          // Storage full/blocked — the list is a convenience only.
        }
        return next;
      });
    },
    [walletAddress]
  );

  return { recents, recordSend };
}

// Wallet stash square shared by the "To" cell and the recent-recipient rows.
function RecipientStashIcon() {
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-[11px] bg-accent">
      <Wallet className="text-muted-foreground" size={24} strokeWidth={1.8} />
    </span>
  );
}

// Send screen (Figma 4852:38932 / ready 4852:41339): an amount form with a
// recipient cell under the source asset cell. Execution is the OG
// SendContent routing through useSend — and the results walk the shared
// action screens.
export function SendPane({
  onBack,
  onDone,
  onFormActiveChange,
  onOpenAssetSelect,
  onOpenRecipientSelect,
  onSuccess,
  recipient,
  recordRecent,
  token,
}: {
  onBack: () => void;
  onDone: () => void;
  onFormActiveChange?: (isFormActive: boolean) => void;
  onOpenAssetSelect: () => void;
  onOpenRecipientSelect: () => void;
  onSuccess: () => void;
  recipient: string | null;
  recordRecent: (address: string) => void;
  token: SwapToken;
}) {
  const { executeSend } = useSend();
  const { isBalanceHidden } = useBalanceVisibility();

  const [amountInput, setAmountInput] = useState("");
  const [isUsdInput, setIsUsdInput] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "processing" | "success" | "error">(
    "form"
  );
  const [txSignature, setTxSignature] = useState<string | null>(null);

  // The selector/recipient panes only make sense against the form — the
  // parent hides them while a submit runs and on the result screens.
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
  const insufficientFunds = hasAmount && tokenAmount > token.balance;
  const hasRecipient = recipient !== null && isValidSolanaAddress(recipient);
  const isReady = hasAmount && !insufficientFunds && hasRecipient;

  const handleAmountChange = (rawValue: string) => {
    const sanitized = sanitizeBucksAmountInput(rawValue, amountInput);
    if (sanitized !== null) {
      setAmountInput(sanitized);
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
    if (token.symbol.toUpperCase() === "SOL") {
      value = Math.max(0, value - SOL_FEE_RESERVE);
    }
    if (value <= 0) {
      setAmountInput("");
      return;
    }
    setAmountInput(
      isUsdInput
        ? String(Number((value * token.price).toFixed(2)))
        : String(Number(value.toFixed(9)))
    );
  };

  const handleConfirm = async () => {
    if (!isReady || isSubmitting || recipient === null) {
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    setTxSignature(null);
    setStep("processing");
    const tracking = {
      token_symbol: token.symbol,
      token_mint: token.mint,
      amount: String(tokenAmount),
      usd_value: `$${formatUsdAmount(usdAmount)}`,
      destination_type: "wallet",
      is_private: false,
    };
    const result = await executeSend(
      token.symbol,
      String(tokenAmount),
      recipient,
      token.mint,
      undefined,
      tracking
    );
    setIsSubmitting(false);
    if (result.success) {
      setTxSignature(result.signature ?? null);
      setAmountInput("");
      recordRecent(recipient);
      onSuccess();
      setStep("success");
      return;
    }
    setErrorMessage(result.error ?? "Send failed. Please try again.");
    setStep("error");
  };

  const ctaLabel = !hasAmount
    ? "Enter amount"
    : insufficientFunds
    ? "Insufficient funds"
    : hasRecipient
    ? "Send"
    : "Enter recipient";
  const isCtaInvalid = !isReady;
  const ctaDisabled = isCtaInvalid || isSubmitting;

  const balanceSplit = splitUsdBalance(token.balance * token.price);

  return (
    /* The result screens unclip the pane on desktop so their dog can drop
        into the shell's 8px gap and sit flush with the viewport bottom (same
        escape the earn empty pane uses); the form keeps the clip. */
    <section
      className={`flex h-full w-full min-w-0 flex-1 flex-col rounded-3xl bg-card max-[795px]:rounded-none ${
        step === "success" || step === "error"
          ? "max-[795px]:overflow-clip"
          : "overflow-clip"
      }`}
    >
      <header className="flex w-full shrink-0 items-center p-2">
        <div className="flex shrink-0 items-center pr-3">
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
        <div className="flex min-w-0 flex-1 items-center py-2">
          <h1 className="truncate whitespace-nowrap font-semibold text-[20px] text-foreground leading-6">
            Send
          </h1>
        </div>
      </header>

      <PaneReveal key={step}>
        {step === "form" ? (
          <>
            <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto">
              <div className="w-full shrink-0 p-2">
                <div className="flex w-full flex-col gap-0.5 px-4 py-2">
                  <p className="whitespace-nowrap text-[16px] leading-5 text-muted-foreground">
                    Amount
                  </p>
                  <div className="flex w-full items-center">
                    <div className="flex h-12 min-w-0 flex-1 items-baseline">
                      {isUsdInput ? (
                        <span className="font-semibold text-[40px] text-foreground leading-[48px]">
                          $
                        </span>
                      ) : null}
                      <input
                        autoFocus
                        className="w-full min-w-0 bg-transparent font-semibold text-[40px] text-foreground leading-[48px] outline-none placeholder:text-tertiary"
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
                        className="t-hover flex size-11 items-center justify-center rounded-3xl hover:bg-accent"
                        onClick={handleToggleCurrency}
                        type="button"
                      >
                        <ThemedIcon
                          className="size-6 text-tertiary"
                          src={`${ASSET_BASE}/icon-arrow-top-bottom.svg`}
                        />
                      </button>
                    </div>
                  </div>
                  <p className="whitespace-nowrap text-[16px] leading-5 text-muted-foreground">
                    {isUsdInput
                      ? `${formatTokenAmount(tokenAmount)} ${token.symbol}`
                      : `$${formatUsdAmount(usdAmount)}`}
                  </p>
                </div>
              </div>

              {/* Network fee row (Figma 4852:41339) — appears once the form is
                  ready. The fee matches the OG flow's flat reserve. */}
              {isReady ? (
                <div className="w-full shrink-0 px-2">
                  <div className="flex w-full items-center justify-between rounded-xl bg-accent px-4 py-2.5">
                    <span className="text-[13px] leading-4 text-muted-foreground">
                      Network Fee
                    </span>
                    <span className="text-[13px] text-foreground leading-4">
                      {SOL_FEE_RESERVE} SOL ~ &lt;$0.01
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Source asset + recipient cells pinned above the CTA, joined
                  by the little connector (Figma 4852:38981). */}
              <div className="relative mt-auto flex w-full shrink-0 flex-col gap-1 p-2">
                <span
                  aria-hidden="true"
                  className="-translate-y-1/2 absolute top-1/2 left-[45px] h-3.5 w-0.5 rounded-full bg-border"
                />
                <div className="t-hover flex w-full items-center rounded-2xl px-4 hover:bg-accent">
                  <button
                    className="flex min-w-0 flex-1 items-center text-left"
                    onClick={onOpenAssetSelect}
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
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1 py-2">
                      <SplitAmount
                        fraction={balanceSplit.balanceFraction}
                        fractionColor="var(--tertiary)"
                        isHidden={isBalanceHidden}
                        isRevealed
                        whole={balanceSplit.balanceWhole}
                      />
                      <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
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
                      className="t-hover flex min-w-16 items-center justify-center rounded-full bg-accent px-4 py-2.5 font-medium text-[13px] text-foreground leading-4 hover:bg-accent-active"
                      onClick={handleMax}
                      type="button"
                    >
                      MAX
                    </button>
                  </span>
                  <button
                    aria-label="Select asset"
                    className="flex shrink-0 items-center py-2 pl-3"
                    onClick={onOpenAssetSelect}
                    type="button"
                  >
                    <ThemedIcon
                      className="size-6 text-muted-foreground"
                      src={`${ASSET_BASE}/icon-chevron-grabber.svg`}
                    />
                  </button>
                </div>
                <button
                  className="t-hover flex w-full items-center rounded-2xl px-4 text-left hover:bg-accent"
                  onClick={onOpenRecipientSelect}
                  type="button"
                >
                  <span className="flex shrink-0 items-center py-2 pr-3">
                    <RecipientStashIcon />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1 py-2">
                    <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
                      To
                    </span>
                    <span
                      className={`truncate font-medium text-[20px] leading-6 ${
                        recipient ? "text-foreground" : "text-tertiary"
                      }`}
                    >
                      {recipient
                        ? truncateAddress(recipient)
                        : "Select recipient"}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center pl-3">
                    <ThemedIcon
                      className="size-6 text-tertiary"
                      src={`${ASSET_BASE}/icon-chevron-right.svg`}
                    />
                  </span>
                </button>
              </div>
            </div>

            <div className="w-full shrink-0 bg-card px-4 pt-2 pb-4">
              <button
                className={`flex h-12 w-full items-center justify-center rounded-full font-medium text-[16px] leading-5 transition-colors ${
                  isCtaInvalid
                    ? "bg-primary/[0.08] text-primary"
                    : ctaDisabled
                    ? "bg-foreground text-background opacity-60"
                    : "t-hover bg-foreground text-background hover:-translate-y-0.5 hover:bg-foreground/90 active:translate-y-0"
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
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                aria-hidden="true"
                className="size-16 rounded-full object-cover"
                src={token.icon || getTokenIconUrl(token.symbol)}
              />
            }
            label="Sending"
          />
        ) : step === "success" ? (
          <ActionSuccessBody
            label="Sent"
            onDone={onDone}
            signature={txSignature}
            source="send_success"
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

// "Recipient" pane (Figma 4852:39997 / invalid 4852:40400): the send screen's
// right pane — a borderless address input with Paste, live validation, and
// the recently-used list. A valid address (typed, pasted, or picked) commits
// immediately; the parent closes the pane.
export function SendRecipientPane({
  onClose,
  onSelect,
  recents,
}: {
  onClose?: () => void;
  onSelect: (address: string) => void;
  recents: SendRecentRecipient[];
}) {
  const [input, setInput] = useState("");
  const trimmed = input.trim();
  const isInvalid = trimmed.length > 0 && !isValidSolanaAddress(trimmed);

  const commitIfValid = useCallback(
    (value: string) => {
      const candidate = value.trim();
      setInput(value);
      if (isValidSolanaAddress(candidate)) {
        onSelect(candidate);
      }
    },
    [onSelect]
  );

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        commitIfValid(text);
      }
    } catch {
      // Clipboard permission denied — the user can still type the address.
    }
  };

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <header className="flex w-full shrink-0 items-center p-2">
        <div className="flex min-w-0 flex-1 items-center py-2.5 pl-4 max-[795px]:pl-2">
          <h2 className="truncate whitespace-nowrap font-semibold text-[20px] text-foreground leading-6">
            Recipient
          </h2>
        </div>
        {onClose ? (
          <div className="flex shrink-0 items-center pl-3">
            <button
              aria-label="Close"
              className="t-hover flex size-11 items-center justify-center rounded-3xl hover:bg-accent"
              onClick={onClose}
              type="button"
            >
              <ThemedIcon
                className="size-6 text-muted-foreground"
                src={`${ASSET_BASE}/icon-cross.svg`}
              />
            </button>
          </div>
        ) : null}
      </header>

      {/* px-6 = the header's 8px shell padding + 16px, so the input's left
          edge lines up with the "Recipient" title above it. */}
      <div className="w-full shrink-0 px-6 pt-6 pb-2">
        <div className="flex w-full items-center">
          <input
            autoFocus
            className="min-w-0 flex-1 bg-transparent font-medium text-[20px] text-foreground leading-6 outline-none placeholder:text-tertiary"
            onChange={(event) => commitIfValid(event.target.value)}
            placeholder="Solana address"
            spellCheck={false}
            type="text"
            value={input}
          />
          <span className="flex shrink-0 items-center pl-3">
            {trimmed.length > 0 ? (
              <button
                aria-label="Clear address"
                className="t-hover flex size-11 items-center justify-center rounded-3xl hover:bg-accent"
                onClick={() => setInput("")}
                type="button"
              >
                <CircleX className="text-tertiary" size={24} />
              </button>
            ) : (
              <button
                className="t-hover flex min-w-16 items-center justify-center rounded-full bg-accent px-4 py-2.5 font-medium text-[13px] text-foreground leading-4 hover:bg-accent-active"
                onClick={() => void handlePaste()}
                type="button"
              >
                Paste
              </button>
            )}
          </span>
        </div>
        {isInvalid ? (
          <p className="pt-2 text-destructive text-[14px] leading-5">
            Invalid Solana address
          </p>
        ) : null}
      </div>

      {recents.length > 0 ? (
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto p-2">
          <p className="px-4 pt-3 pb-2 text-[16px] leading-5 text-muted-foreground tracking-[-0.176px]">
            Recently used
          </p>
          {recents.map((entry) => (
            <button
              className="t-hover flex w-full shrink-0 items-center rounded-2xl px-4 text-left hover:bg-accent"
              key={entry.address}
              onClick={() => onSelect(entry.address)}
              type="button"
            >
              <span className="flex shrink-0 items-center py-2 pr-3">
                <RecipientStashIcon />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
                <span className="truncate font-medium text-[16px] text-foreground leading-5 tracking-[-0.176px]">
                  {truncateAddress(entry.address)}
                </span>
                <span className="whitespace-nowrap text-muted-foreground text-[13px] leading-4">
                  {entry.count === 1 ? "1 send" : `${entry.count} sends`}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
