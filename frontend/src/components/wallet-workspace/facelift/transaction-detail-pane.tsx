"use client";

import { useState } from "react";

import { EarnYieldIcon } from "@/components/wallet-sidebar/portfolio-content";
import {
  formatEarnTransactionDateGroup,
  formatEarnTransactionTimestamp,
  getEarnTransactionAmountColor,
  getEarnTransactionRowLabel,
} from "@/components/wallet-workspace/earn-transactions-pane";
import { copyTextToClipboard } from "@/components/wallet-workspace/facelift/copy-text";
import {
  DualIcon,
  UsdcCoinImage,
} from "@/components/wallet-workspace/facelift/earn-activity-card";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import { usePublicEnv } from "@/contexts/public-env-context";
import { openTrackedLink } from "@/lib/core/analytics";
import { getExplorerTxUrl } from "@/lib/solana/explorer";
import type { EarnTransactionItem } from "@/lib/yield-optimization/earn-transactions.client";

const ASSET_BASE = "/wallet-workspace/facelift";

function truncateMiddle(value: string): string {
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

// One From/To style row (Figma "Cell"): 44px tile, 13px label, 16px value.
function RouteRow({
  icon,
  label,
  value,
  valueSuffix,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueSuffix?: string;
}) {
  return (
    <div className="flex h-[60px] w-full items-center rounded-2xl px-4">
      <div className="flex shrink-0 items-center py-2 pr-3">{icon}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
        <p className="text-[13px] leading-4 text-muted-foreground">
          {label}
        </p>
        <p className="truncate font-medium text-[16px] text-foreground leading-5">
          {value}
          {valueSuffix ? (
            <span className="text-tertiary"> · {valueSuffix}</span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

// The wallet side ("Main") renders as the same USDC coin art the activity
// rows use — the API's icon for it is the legacy agent avatar. Market sides
// carry their own logos; abstract sides (Earn / Autodeposit) fall back to the
// Earn glyph.
function RouteTile({ side }: { side: EarnTransactionItem["source"] }) {
  if (side.label === "Main") {
    return (
      <span className="relative block size-11 overflow-hidden rounded-full">
        <UsdcCoinImage />
      </span>
    );
  }
  if (side.icon) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt=""
        aria-hidden="true"
        className="size-11 rounded-full object-cover"
        src={side.icon}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      aria-hidden="true"
      className="size-11"
      src={`${ASSET_BASE}/earn-icon.svg`}
    />
  );
}

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex w-full flex-col gap-0.5 px-4 py-[11px]">
      <p className="text-[13px] leading-4 text-muted-foreground">{label}</p>
      <p className="text-[16px] text-foreground leading-5 tracking-[-0.176px]">
        {value}
      </p>
    </div>
  );
}

function SignatureCell({ signature }: { signature: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex w-full items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-[11px]">
        <p className="text-[13px] leading-4 text-muted-foreground">Signature</p>
        <p className="truncate text-[16px] text-foreground leading-5 tracking-[-0.176px]">
          {truncateMiddle(signature)}
        </p>
      </div>
      <button
        aria-label="Copy transaction signature"
        className="t-hover flex shrink-0 items-center justify-center px-4"
        onClick={() => {
          void copyTextToClipboard(signature).then((didCopy) => {
            if (didCopy) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }
          });
        }}
        type="button"
      >
        <ThemedIcon
          className="size-6 text-tertiary"
          src={`${ASSET_BASE}/${copied ? "icon-check.svg" : "icon-copy.svg"}`}
        />
      </button>
    </div>
  );
}

// Earn transaction detail in the wallet detail's design (Figma 4879:69018
// Deposited / 4880:74343 Withdrawn): identity header, amount hero, From → To
// route rows, details card, explorer button pinned bottom. Covers every
// indexed Earn event — create & deposit, deposit, withdraw, withdraw & close,
// create/remove allowance, balance sweep, rebalanced, reconciled. Allowance
// events skip the hero (their indexed amount is always $0.00) and rebalances
// without a signature drop the signature cell and explorer button.
export function EarnTransactionDetailPane({
  item,
  onClose,
  walletAddress,
}: {
  item: EarnTransactionItem;
  onClose: () => void;
  walletAddress: string | null;
}) {
  const publicEnv = usePublicEnv();
  const isMovement =
    item.kind === "rebalance" || item.kind === "reconciliation";
  const isAllowanceAction = item.kind === "autodeposit_action";
  const title = getEarnTransactionRowLabel(item);
  const confirmedAt = item.confirmedAt ?? item.sortTimestamp;
  const dateLabel =
    formatEarnTransactionDateGroup(confirmedAt) ?? item.dateGroup;
  const timeLabel =
    formatEarnTransactionTimestamp(confirmedAt) ?? item.timestamp;
  const ownAddress = walletAddress ? truncateMiddle(walletAddress) : null;
  const hasSignature = item.signature.length > 0;
  const transactionUrl = getExplorerTxUrl(item.signature);
  // Same art derivation as the activity list's TransactionRow, so the header
  // identity matches the row that opened it.
  const backSrc =
    isMovement || item.kind === "withdraw" ? item.source.icon : null;
  const frontSrc =
    isMovement || item.kind === "deposit" ? item.destination.icon : null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="flex w-full shrink-0 items-center p-2">
        {/* pl-4 puts the icon on the same 24px inset as the route rows and
            cards below (title lands on their 80px text column). */}
        <div className="flex shrink-0 items-center pl-4 pr-3">
          {isAllowanceAction ? (
            <span className="inline-flex size-11 shrink-0 overflow-hidden rounded-full">
              <EarnYieldIcon size={44} />
            </span>
          ) : (
            <DualIcon
              backSrc={backSrc}
              frontSrc={frontSrc}
              isWithdraw={item.kind === "withdraw"}
            />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate font-semibold text-[20px] text-foreground leading-6 tracking-[-0.22px]">
            {title}
          </h2>
          <p className="truncate text-[13px] leading-4 text-muted-foreground">
            {dateLabel}, {timeLabel}
          </p>
        </div>
        <button
          aria-label="Close transaction details"
          className="t-hover flex size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-accent"
          onClick={onClose}
          type="button"
        >
          <ThemedIcon
            className="size-6 text-muted-foreground"
            src={`${ASSET_BASE}/icon-cross.svg`}
          />
        </button>
      </header>
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto">
        {isAllowanceAction ? null : (
          <div className="w-full p-2">
            <div className="flex w-full flex-col gap-0.5 px-4 pt-[30px] pb-2">
              <p
                className="whitespace-nowrap font-semibold text-[40px] leading-[48px] tracking-[-0.44px]"
                style={{
                  color: getEarnTransactionAmountColor({ kind: item.kind }),
                }}
              >
                {item.amount}{" "}
                <span className="text-tertiary text-[28px] leading-8 tracking-[-0.308px]">
                  USDC
                </span>
              </p>
              <p className="text-[16px] leading-5 text-muted-foreground">
                {item.rawAmount}
              </p>
            </div>
          </div>
        )}
        <div className="relative w-full px-2 pb-2">
          <RouteRow
            icon={<RouteTile side={item.source} />}
            label="From"
            value={item.source.label}
            valueSuffix={
              item.source.label === "Main" ? ownAddress ?? undefined : undefined
            }
          />
          <RouteRow
            icon={<RouteTile side={item.destination} />}
            label="To"
            value={item.destination.label}
            valueSuffix={
              item.destination.label === "Main"
                ? ownAddress ?? undefined
                : undefined
            }
          />
          {/* Connector between the two 60px route rows. */}
          <span className="absolute top-[54px] left-[45px] h-3 w-0.5 rounded-xl bg-border" />
        </div>
        <div className="w-full p-2">
          <div className="flex w-full flex-col rounded-2xl bg-accent">
            {hasSignature ? <SignatureCell signature={item.signature} /> : null}
            <DetailCell label="Slot" value={item.confirmedSlot} />
          </div>
        </div>
      </div>
      {hasSignature ? (
        <div className="w-full shrink-0 bg-card px-5 pt-2 pb-4">
          <button
            className="t-hover flex h-12 w-full items-center justify-center rounded-full bg-foreground font-medium text-[16px] text-background leading-5 hover:-translate-y-0.5 hover:bg-foreground/90 active:translate-y-0"
            onClick={() =>
              openTrackedLink(publicEnv, {
                href: transactionUrl,
                linkText: "View on Orb Markets",
                source: "transaction_detail",
              })
            }
            type="button"
          >
            View on Orb Markets
          </button>
        </div>
      ) : null}
    </div>
  );
}
