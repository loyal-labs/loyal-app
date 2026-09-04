"use client";

import type { PortfolioPosition } from "@loyal-labs/solana-wallet";
import { TOKEN_DECIMALS, TOKEN_MINTS } from "@loyal-labs/wallet-core/constants";
import type {
  ShieldedBalance,
  UnshieldResult,
} from "@loyal-labs/wallet-core/hooks";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import {
  ActionErrorBody,
  ActionProcessingBody,
  ActionSuccessBody,
  formatTokenAmount,
  formatUsdAmount,
} from "@/components/wallet-workspace/facelift/action-screens";
import {
  ScrambleText,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { PaneReveal } from "@/components/wallet-workspace/facelift/pane-transitions";
import { SplitAmount } from "@/components/wallet-workspace/facelift/sidebar";
import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import { splitUsdBalance } from "@/hooks/use-wallet-desktop-data";
import { resolveKnownTokenMetadata } from "@/lib/solana/frontend-asset-provider";
import { getTokenIconUrl } from "@/lib/token-icon";

const ASSET_BASE = "/wallet-workspace/facelift";

// A shielded position resolved for display. Symbol/decimals/price come from
// the held position when the wallet also holds the token publicly, else the
// static token tables; unknown mints show the raw base units so a wrong
// scale never misreads the balance.
export type ShieldedRow = {
  amount: number | null;
  amountLabel: string;
  icon: string;
  mint: string;
  symbol: string;
  usdValue: number | null;
  valueLabel: string;
};

export function toShieldedRow(
  balance: ShieldedBalance,
  positions: PortfolioPosition[]
): ShieldedRow {
  const position = positions.find(
    (candidate) => candidate.asset.mint === balance.tokenMint
  );
  const known = resolveKnownTokenMetadata(balance.tokenMint)?.descriptor;
  const staticSymbol = Object.keys(TOKEN_MINTS).find(
    (symbol) => TOKEN_MINTS[symbol] === balance.tokenMint
  );
  const symbol =
    position?.asset.symbol ??
    known?.symbol ??
    staticSymbol ??
    `${balance.tokenMint.slice(0, 4)}…${balance.tokenMint.slice(-4)}`;
  const decimals =
    position?.asset.decimals ??
    known?.decimals ??
    (staticSymbol ? TOKEN_DECIMALS[staticSymbol] : undefined);
  const amount =
    decimals === undefined ? null : Number(balance.amountRaw) / 10 ** decimals;
  const priceUsd = position?.priceUsd ?? null;
  const usdValue =
    amount !== null && priceUsd !== null ? amount * priceUsd : null;
  return {
    amount,
    amountLabel:
      amount === null
        ? `${balance.amountRaw.toString()} base units`
        : formatTokenAmount(amount),
    icon:
      position?.asset.imageUrl ?? known?.imageUrl ?? getTokenIconUrl(symbol),
    mint: balance.tokenMint,
    symbol,
    usdValue,
    valueLabel: usdValue === null ? "" : `$${formatUsdAmount(usdValue)}`,
  };
}

// Token avatar with the shield badge that marks a balance as still held in
// the private-transfer program.
export function ShieldedTokenIcon({
  icon,
  size = 11,
}: {
  icon: string;
  size?: 11 | 16;
}) {
  const box = size === 16 ? "size-16" : "size-11";
  const badge = size === 16 ? "size-7" : "size-5";
  const glyph = size === 16 ? 16 : 12;
  return (
    <span className={`relative block shrink-0 ${box}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        className={`${box} rounded-full object-cover`}
        src={icon}
      />
      <span
        className={`-right-0.5 -bottom-0.5 absolute flex ${badge} items-center justify-center rounded-full bg-card text-foreground ring-2 ring-card`}
      >
        <ShieldCheck size={glyph} strokeWidth={2.2} />
      </span>
    </span>
  );
}

// Exit-only screen for the sunset private-transfer program (ASK-2269): a
// Send-style confirm for one shielded token at a time — full balance, one
// signature. Results walk the shared action screens like Send/Swap.
export function UnshieldPane({
  executeUnshield,
  initialMint,
  onBack,
  onDone,
  onSuccess,
  rows,
}: {
  executeUnshield: (tokenMint: string) => Promise<UnshieldResult>;
  initialMint?: string;
  onBack: () => void;
  onDone: () => void;
  onSuccess: () => void;
  rows: ShieldedRow[];
}) {
  const { isBalanceHidden } = useBalanceVisibility();
  const [step, setStep] = useState<
    "confirm" | "select" | "processing" | "success" | "error"
  >("confirm");
  const [selectedMint, setSelectedMint] = useState<string | null>(
    initialMint ?? rows[0]?.mint ?? null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const row = rows.find((candidate) => candidate.mint === selectedMint) ?? rows[0];
  const canPickToken = rows.length > 1;
  const usdSplit = splitUsdBalance(row?.usdValue ?? 0);

  const handleConfirm = async () => {
    if (!row) return;
    setTxSignature(null);
    setStep("processing");
    const result = await executeUnshield(row.mint);
    if (result.success) {
      setTxSignature(result.signature ?? null);
      onSuccess();
      setStep("success");
      return;
    }
    setErrorMessage(result.error ?? "Unshield failed. Please try again.");
    setStep("error");
  };

  return (
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
            onClick={step === "select" ? () => setStep("confirm") : onBack}
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
            {step === "select" ? "Select asset" : "Unshield"}
          </h1>
        </div>
      </header>

      <PaneReveal key={step}>
        {step === "confirm" && row ? (
          <>
            <div className="flex min-h-0 w-full flex-1 flex-col">
              {/* Hero amount (Send's amount block, read-only): the full
                  shielded balance is what leaves — there is no partial. */}
              <div className="flex w-full flex-1 flex-col items-center justify-center gap-4 p-8">
                <ShieldedTokenIcon icon={row.icon} size={16} />
                <div className="flex flex-col items-center gap-1">
                  <p className="text-center font-semibold text-[40px] text-foreground leading-[48px] tracking-[-0.4px]">
                    <ScrambleText
                      isHidden={isBalanceHidden}
                      text={`${row.amountLabel} ${row.symbol}`}
                    />
                  </p>
                  {row.usdValue !== null ? (
                    <p className="text-[16px] leading-5 text-muted-foreground">
                      <ScrambleText
                        isHidden={isBalanceHidden}
                        text={`$${formatUsdAmount(row.usdValue)}`}
                      />
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="w-full shrink-0 px-2">
                <div className="flex w-full items-center justify-between rounded-xl bg-accent px-4 py-2.5">
                  <span className="text-[13px] leading-4 text-muted-foreground">
                    Destination
                  </span>
                  <span className="text-[13px] text-foreground leading-4">
                    Your wallet
                  </span>
                </div>
              </div>

              {/* Source cell pinned above the CTA, like Send's asset cell. */}
              <div className="mt-auto flex w-full shrink-0 flex-col gap-1 p-2">
                <button
                  className={`flex w-full items-center rounded-2xl px-4 text-left ${
                    canPickToken ? "t-hover hover:bg-accent" : "cursor-default"
                  }`}
                  disabled={!canPickToken}
                  onClick={() => setStep("select")}
                  type="button"
                >
                  <span className="flex shrink-0 items-center py-2 pr-3">
                    <ShieldedTokenIcon icon={row.icon} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1 py-2">
                    {row.usdValue !== null ? (
                      <SplitAmount
                        fraction={usdSplit.balanceFraction}
                        isHidden={isBalanceHidden}
                        isRevealed
                        whole={usdSplit.balanceWhole}
                      />
                    ) : (
                      <span className="font-medium text-[20px] text-foreground leading-6">
                        {row.symbol}
                      </span>
                    )}
                    <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
                      <ScrambleText
                        isHidden={isBalanceHidden}
                        text={`${row.amountLabel} ${row.symbol} shielded`}
                      />
                    </span>
                  </span>
                  {canPickToken ? (
                    <span className="flex shrink-0 items-center py-2 pl-3">
                      <ThemedIcon
                        className="size-6 text-muted-foreground"
                        src={`${ASSET_BASE}/icon-chevron-grabber.svg`}
                      />
                    </span>
                  ) : null}
                </button>
              </div>
            </div>

            <div className="w-full shrink-0 bg-card px-4 pt-2 pb-4">
              <button
                className="t-hover flex h-12 w-full items-center justify-center rounded-full bg-foreground font-medium text-[16px] text-background leading-5 transition-colors hover:-translate-y-0.5 hover:bg-foreground/90 active:translate-y-0"
                onClick={() => void handleConfirm()}
                type="button"
              >
                <TextSwap text={`Unshield ${row.symbol}`} />
              </button>
            </div>
          </>
        ) : step === "select" ? (
          <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto p-2">
            {rows.map((candidate) => (
              <button
                className={`t-hover flex w-full items-center rounded-2xl px-4 text-left hover:bg-accent ${
                  candidate.mint === row?.mint ? "bg-accent" : ""
                }`}
                key={candidate.mint}
                onClick={() => {
                  setSelectedMint(candidate.mint);
                  setStep("confirm");
                }}
                type="button"
              >
                <span className="flex shrink-0 items-center py-2 pr-3">
                  <ShieldedTokenIcon icon={candidate.icon} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
                  <span className="truncate font-medium text-[16px] text-foreground leading-5">
                    {candidate.symbol}
                  </span>
                  <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
                    <ScrambleText
                      isHidden={isBalanceHidden}
                      text={`${candidate.amountLabel} ${candidate.symbol}`}
                    />
                  </span>
                </span>
                {candidate.valueLabel ? (
                  <span className="shrink-0 pl-3 font-medium text-[16px] text-foreground leading-5">
                    <ScrambleText
                      isHidden={isBalanceHidden}
                      text={candidate.valueLabel}
                    />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : step === "processing" ? (
          <ActionProcessingBody
            icons={<ShieldedTokenIcon icon={row?.icon ?? ""} size={16} />}
            label="Unshielding"
          />
        ) : step === "success" ? (
          <ActionSuccessBody
            label="Unshielded"
            onDone={onDone}
            signature={txSignature}
            source="unshield_success"
          />
        ) : (
          <ActionErrorBody
            message={errorMessage}
            onBack={() => {
              setErrorMessage(null);
              setStep("confirm");
            }}
          />
        )}
      </PaneReveal>
    </section>
  );
}
