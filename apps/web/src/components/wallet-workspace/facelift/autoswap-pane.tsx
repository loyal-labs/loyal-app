"use client";

import { useMemo, useState } from "react";

import { TextSwap } from "@/components/wallet-workspace/facelift/text-swap";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import type { EarnPositionData } from "@/components/wallet-workspace/facelift/use-earn-position-data";
import {
  MAX_AUTOSWAP_DAILY_CAP_RAW,
  MIN_AUTOSWAP_DAILY_CAP_RAW,
} from "@/lib/yield-optimization/earn-cross-mint-policy-contracts.shared";

const ASSET_BASE = "/wallet-workspace/facelift";
const STABLECOIN_DECIMALS = 6;

function formatDailyCap(raw: string): string {
  const amount = BigInt(raw);
  const scale = BigInt(10 ** STABLECOIN_DECIMALS);
  const whole = amount / scale;
  const fraction = (amount % scale)
    .toString()
    .padStart(STABLECOIN_DECIMALS, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function sanitizeUsdInput(value: string): string | null {
  const normalized = value.replace(/,/g, "").trim();
  if (!/^\d*(?:\.\d{0,6})?$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function parseDailyCapRaw(value: string): bigint | null {
  if (!value || value === ".") {
    return null;
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const raw = BigInt(whole || "0") * BigInt(10 ** STABLECOIN_DECIMALS);
  const fractionRaw = BigInt(
    (fraction || "").padEnd(STABLECOIN_DECIMALS, "0") || "0"
  );
  const result = raw + fractionRaw;
  return result > BigInt(0) ? result : null;
}

export function AutoswapPane({
  data,
  onBack,
}: {
  data: EarnPositionData;
  onBack: () => void;
}) {
  const current = data.autoswapConfig;
  const [dailyCap, setDailyCap] = useState(() =>
    current ? formatDailyCap(current.dailySourceMintSpendingCap) : "100"
  );
  const [isDeleteArmed, setIsDeleteArmed] = useState(false);
  const dailyCapRaw = useMemo(() => parseDailyCapRaw(dailyCap), [dailyCap]);
  const isDailyCapValid = Boolean(
    dailyCapRaw &&
      dailyCapRaw >= MIN_AUTOSWAP_DAILY_CAP_RAW &&
      dailyCapRaw <= MAX_AUTOSWAP_DAILY_CAP_RAW
  );
  const isPending = data.isAutoswapPending;
  const isFinalizing = current?.status === "finalizing";
  const isPaused = current?.status === "paused";

  const handlePrimaryAction = async () => {
    if (!dailyCapRaw) {
      return;
    }
    const didSetup = await data.setupAutoswap({
      dailySourceMintSpendingCap: dailyCapRaw,
    });
    if (didSetup) {
      onBack();
    }
  };
  const handleDelete = async () => {
    if (!isDeleteArmed) {
      setIsDeleteArmed(true);
      return;
    }
    const didDelete = await data.deleteAutoswap();
    if (didDelete) {
      onBack();
    } else {
      setIsDeleteArmed(false);
    }
  };

  return (
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
        <div className="flex min-w-0 flex-1 flex-col py-2">
          <h1 className="truncate font-semibold text-[20px] text-foreground leading-6">
            Autoswap
          </h1>
          <p className="text-[13px] leading-4 text-muted-foreground">
            Move Earn funds when another stablecoin route pays more
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
        <div className="rounded-2xl bg-accent/60 p-4">
          <p className="text-[13px] leading-5 text-muted-foreground">
            Loyal can withdraw, swap through Jupiter, and redeposit across the
            supported stablecoins. Every move must stay inside the on-chain
            daily spending limit you approve and Loyal&apos;s fixed 0.5% maximum
            slippage.
          </p>
          {!current ? (
            <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
              A fresh setup uses two wallet approvals so these same safety
              limits can cover every supported stablecoin. If setup is
              interrupted, retrying continues with the remaining approval.
            </p>
          ) : null}
        </div>

        <label className="mt-5 flex flex-col gap-2">
          <span className="font-medium text-[14px] text-foreground leading-5">
            Daily swap limit per stablecoin
          </span>
          <div className="flex h-14 items-center rounded-2xl bg-accent px-4">
            <span className="font-semibold text-[24px] text-foreground">$</span>
            <input
              className="min-w-0 flex-1 bg-transparent pl-1 font-semibold text-[24px] text-foreground outline-none disabled:opacity-60"
              disabled={Boolean(current)}
              inputMode="decimal"
              onChange={(event) => {
                const next = sanitizeUsdInput(event.target.value);
                if (next !== null) {
                  setDailyCap(next);
                }
              }}
              value={dailyCap}
            />
          </div>
        </label>

        {!current && dailyCapRaw && !isDailyCapValid ? (
          <p className="mt-2 text-[13px] leading-5 text-destructive">
            Choose a daily limit between $1 and $1,000.
          </p>
        ) : null}

        <p className="mt-4 text-[13px] leading-5 text-muted-foreground">
          This limit is immutable while Autoswap is installed. To change it,
          delete Autoswap and set it up again.
        </p>

        {isFinalizing ? (
          <p className="mt-4 rounded-2xl bg-primary/10 px-4 py-3 text-[13px] leading-5 text-primary">
            The policies are finalized on-chain. Loyal is verifying both
            permissions before routing can begin.
          </p>
        ) : null}
        {isPaused ? (
          <p className="mt-4 rounded-2xl bg-accent px-4 py-3 text-[13px] leading-5 text-muted-foreground">
            Autoswap is paused. Loyal will not start a new cross-mint move, but
            it can still finish or safely recover a move already in progress.
          </p>
        ) : null}
        {data.autoswapError ? (
          <p className="mt-4 text-[13px] leading-5 text-destructive">
            {data.autoswapError}
          </p>
        ) : null}
      </div>

      <div className="flex w-full flex-col gap-2 px-4 pt-2 pb-4">
        {current ? (
          <button
            className="t-hover flex h-12 w-full items-center justify-center rounded-full bg-destructive/[0.08] font-medium text-[16px] text-destructive enabled:hover:bg-destructive/[0.14] disabled:opacity-60"
            disabled={isPending}
            onClick={() => void handleDelete()}
            type="button"
          >
            <TextSwap
              text={
                isPending
                  ? "Waiting for wallet…"
                  : isDeleteArmed
                  ? "Confirm delete"
                  : "Delete Autoswap"
              }
            />
          </button>
        ) : (
          <button
            className="t-hover flex h-12 w-full items-center justify-center rounded-full bg-foreground font-medium text-[16px] text-background enabled:hover:-translate-y-0.5 enabled:hover:bg-foreground/90 enabled:active:translate-y-0 disabled:opacity-60"
            disabled={!isDailyCapValid || isPending}
            onClick={() => void handlePrimaryAction()}
            type="button"
          >
            <TextSwap
              text={
                isPending
                  ? "Waiting for wallet…"
                  : "Continue · up to 2 approvals"
              }
            />
          </button>
        )}
      </div>
    </section>
  );
}
