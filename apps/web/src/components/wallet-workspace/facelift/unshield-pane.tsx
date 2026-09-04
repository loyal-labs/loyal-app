"use client";

import type { PortfolioPosition } from "@loyal-labs/solana-wallet";
import { TOKEN_DECIMALS, TOKEN_MINTS } from "@loyal-labs/wallet-core/constants";
import type {
  ShieldedBalance,
  UnshieldResult,
} from "@loyal-labs/wallet-core/hooks";
import { useState } from "react";

import {
  ActionErrorBody,
  ActionProcessingBody,
  ActionSuccessBody,
  formatTokenAmount,
} from "@/components/wallet-workspace/facelift/action-screens";
import { PaneReveal } from "@/components/wallet-workspace/facelift/pane-transitions";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import { resolveKnownTokenMetadata } from "@/lib/solana/frontend-asset-provider";
import { getTokenIconUrl } from "@/lib/token-icon";

const ASSET_BASE = "/wallet-workspace/facelift";

type UnshieldRow = {
  amountLabel: string;
  icon: string;
  mint: string;
  symbol: string;
};

// Symbol/decimals come from the held position when the wallet also holds the
// token publicly; otherwise from the static token tables. Unknown mints fall
// back to the raw base-unit amount so nothing is misread by a wrong scale.
function toUnshieldRow(
  balance: ShieldedBalance,
  positions: PortfolioPosition[]
): UnshieldRow {
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
  const amountLabel =
    decimals === undefined
      ? `${balance.amountRaw.toString()} base units`
      : formatTokenAmount(Number(balance.amountRaw) / 10 ** decimals);
  return {
    amountLabel,
    icon:
      position?.asset.imageUrl ?? known?.imageUrl ?? getTokenIconUrl(symbol),
    mint: balance.tokenMint,
    symbol,
  };
}

// Exit-only screen for the sunset private-transfer program (ASK-2269): one
// row per shielded token, each unshielding its full balance. Results walk
// the shared action screens like Send/Swap.
export function UnshieldPane({
  balances,
  executeUnshield,
  onBack,
  onDone,
  onSuccess,
  positions,
}: {
  balances: ShieldedBalance[];
  executeUnshield: (tokenMint: string) => Promise<UnshieldResult>;
  onBack: () => void;
  onDone: () => void;
  onSuccess: () => void;
  positions: PortfolioPosition[];
}) {
  const [step, setStep] = useState<"list" | "processing" | "success" | "error">(
    "list"
  );
  const [activeRow, setActiveRow] = useState<UnshieldRow | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const rows = balances.map((balance) => toUnshieldRow(balance, positions));

  const handleUnshield = async (row: UnshieldRow) => {
    setActiveRow(row);
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
            Unshield
          </h1>
        </div>
      </header>

      <PaneReveal key={step}>
        {step === "list" ? (
          <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto p-2">
            <p className="px-4 py-2 text-[13px] leading-4 text-muted-foreground">
              Shielded balances are being retired. Move each token back to your
              wallet.
            </p>
            {rows.map((row) => (
              <div
                className="flex w-full items-center rounded-2xl px-4"
                key={row.mint}
              >
                <div className="flex shrink-0 items-center py-2 pr-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    className="size-11 rounded-full object-cover"
                    src={row.icon}
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
                  <p className="truncate font-medium text-[16px] text-foreground leading-5">
                    {row.symbol}
                  </p>
                  <p className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
                    {row.amountLabel} shielded
                  </p>
                </div>
                <button
                  className="t-hover flex shrink-0 items-center justify-center rounded-full bg-foreground px-4 py-2.5 font-medium text-[13px] text-background leading-4 hover:bg-foreground/90"
                  onClick={() => void handleUnshield(row)}
                  type="button"
                >
                  Unshield
                </button>
              </div>
            ))}
          </div>
        ) : step === "processing" ? (
          <ActionProcessingBody
            icons={
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                aria-hidden="true"
                className="size-16 rounded-full object-cover"
                src={activeRow?.icon}
              />
            }
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
              setStep("list");
            }}
          />
        )}
      </PaneReveal>
    </section>
  );
}
