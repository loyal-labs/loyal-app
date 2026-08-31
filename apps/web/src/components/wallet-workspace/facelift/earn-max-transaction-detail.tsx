"use client";

import { Infinity as InfinityIcon } from "lucide-react";
import { useState } from "react";

import { copyTextToClipboard } from "@/components/wallet-workspace/facelift/copy-text";
import { EarnMaxDualIcon } from "@/components/wallet-workspace/facelift/earn-max-action-panes";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import { usePublicEnv } from "@/contexts/public-env-context";
import { type EarnMaxActivityItem, EARN_MAX_STRATEGY_NAME } from "@/features/earn-max";
import { openTrackedLink } from "@/lib/core/analytics";
import { getExplorerTxUrl } from "@/lib/solana/explorer";
import { getTokenIconUrl } from "@/lib/token-icon";

const ASSET_BASE = "/wallet-workspace/facelift";

function truncateMiddle(value: string): string {
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export const EARN_MAX_ACTIVITY_LABELS: Record<string, string> = {
  cancel: "Cancel withdrawal",
  claim: "Claim",
  close: "Close",
  deposit: "Deposit",
  install: "Create & Deposit",
  withdraw_request: "Withdraw",
};

export function earnMaxActivityLabel(item: EarnMaxActivityItem): string {
  return (
    EARN_MAX_ACTIVITY_LABELS[item.action] ??
    item.action.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())
  );
}

export function isEarnMaxWithdrawishAction(action: string): boolean {
  return (
    action.includes("withdraw") ||
    action.includes("claim") ||
    action.includes("close") ||
    action.includes("cancel")
  );
}

export function formatEarnMaxUsdcAmount(amountRaw: string): string {
  const value = Number(amountRaw) / 1_000_000;
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

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
        <p className="text-[13px] text-muted-foreground leading-4">{label}</p>
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

function MainTile() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt=""
      aria-hidden="true"
      className="size-11 rounded-full object-cover"
      src={getTokenIconUrl("USDC")}
    />
  );
}

function StrategyTile() {
  return (
    <span className="flex size-11 items-center justify-center rounded-[11px] bg-primary">
      <InfinityIcon aria-hidden="true" className="size-6 text-white" />
    </span>
  );
}

function SignatureCell({ signature }: { signature: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex w-full items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-[11px]">
        <p className="text-[13px] text-muted-foreground leading-4">Signature</p>
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

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex w-full flex-col gap-0.5 px-4 py-[11px]">
      <p className="text-[13px] text-muted-foreground leading-4">{label}</p>
      <p className="text-[16px] text-foreground leading-5 tracking-[-0.176px] capitalize">
        {value}
      </p>
    </div>
  );
}

function RouteLabel({
  destination,
  source,
}: {
  destination: string;
  source: string;
}) {
  return (
    <span className="flex items-center justify-end gap-1">
      <span className="whitespace-nowrap text-[13px] text-muted-foreground leading-4">
        {source}
      </span>
      <ThemedIcon
        className="size-4 text-tertiary"
        src={`${ASSET_BASE}/icon-arrow-right-circle.svg`}
      />
      <span className="whitespace-nowrap text-[13px] text-muted-foreground leading-4">
        {destination}
      </span>
    </span>
  );
}

export function OperationRow({
  amountLabel,
  isSelected = false,
  isWithdraw,
  onSelect,
  subtitle,
  title,
}: {
  amountLabel: string | null;
  isSelected?: boolean;
  isWithdraw: boolean;
  onSelect?: () => void;
  subtitle: string;
  title: string;
}) {
  const content = (
    <>
      <span className="flex items-center py-2 pr-3">
        <EarnMaxDualIcon />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
        <span className="truncate font-medium text-[16px] text-foreground leading-5 tracking-[-0.176px]">
          {title}
        </span>
        <span className="whitespace-nowrap text-[13px] text-muted-foreground leading-4">
          {subtitle}
        </span>
      </span>
      <span className="flex flex-col items-end gap-0.5 py-[11px] pl-3">
        {amountLabel ? (
          <span className="whitespace-nowrap text-right text-[16px] text-foreground leading-5">
            {amountLabel}
          </span>
        ) : null}
        <RouteLabel
          destination={isWithdraw ? "Main" : "Earn MAX"}
          source={isWithdraw ? "Earn MAX" : "Main"}
        />
      </span>
    </>
  );
  // Same interaction contract as the Earn activity rows (TransactionRow):
  // without a handler the row is a plain cell; with one it hovers/selects
  // and opens the transaction detail.
  if (!onSelect) {
    return (
      <div className="flex w-full items-center rounded-2xl px-4">{content}</div>
    );
  }
  return (
    <button
      className={`flex w-full items-center rounded-2xl px-4 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset ${
        isSelected ? "bg-accent" : "hover:bg-accent"
      }`}
      onClick={onSelect}
      type="button"
    >
      {content}
    </button>
  );
}

// Earn MAX flavor of the Earn transaction detail (same layout contract as
// transaction-detail-pane.tsx): identity header, amount hero, From → To
// route, details card, explorer button pinned bottom.
export function EarnMaxTransactionDetailPane({
  item,
  onClose,
  walletAddress,
}: {
  item: EarnMaxActivityItem;
  onClose: () => void;
  walletAddress: string | null;
}) {
  const publicEnv = usePublicEnv();
  const isWithdraw = isEarnMaxWithdrawishAction(item.action);
  const title = earnMaxActivityLabel(item);
  const when = item.timestamp ? new Date(item.timestamp) : null;
  const dateLabel = when
    ? when.toLocaleDateString("en-US", { day: "numeric", month: "short" })
    : "Confirming";
  const timeLabel = when
    ? when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  const ownAddress = walletAddress ? truncateMiddle(walletAddress) : null;
  const strategySide = {
    label: `Earn MAX · ${EARN_MAX_STRATEGY_NAME}`,
  };
  const mainSide = { label: "Main" };
  const source = isWithdraw ? strategySide : mainSide;
  const destination = isWithdraw ? mainSide : strategySide;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="flex w-full shrink-0 items-center p-2">
        <div className="flex shrink-0 items-center pr-3 pl-4">
          <EarnMaxDualIcon />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate font-semibold text-[20px] text-foreground leading-6 tracking-[-0.22px]">
            {title}
          </h2>
          <p className="truncate text-[13px] text-muted-foreground leading-4">
            {timeLabel ? `${dateLabel}, ${timeLabel}` : dateLabel}
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
        {item.amountRaw ? (
          <div className="w-full p-2">
            <div className="flex w-full flex-col gap-0.5 px-4 pt-[30px] pb-2">
              <p className="whitespace-nowrap font-semibold text-[40px] text-foreground leading-[48px] tracking-[-0.44px]">
                {formatEarnMaxUsdcAmount(item.amountRaw)}{" "}
                <span className="text-[28px] text-tertiary leading-8 tracking-[-0.308px]">
                  USDC
                </span>
              </p>
            </div>
          </div>
        ) : null}
        <div className="relative w-full px-2 pb-2">
          <RouteRow
            icon={isWithdraw ? <StrategyTile /> : <MainTile />}
            label="From"
            value={source.label}
            valueSuffix={
              source.label === "Main" ? ownAddress ?? undefined : undefined
            }
          />
          <RouteRow
            icon={isWithdraw ? <MainTile /> : <StrategyTile />}
            label="To"
            value={destination.label}
            valueSuffix={
              destination.label === "Main" ? ownAddress ?? undefined : undefined
            }
          />
          <span className="absolute top-[54px] left-[45px] h-3 w-0.5 rounded-xl bg-border" />
        </div>
        <div className="w-full p-2">
          <div className="flex w-full flex-col rounded-2xl bg-accent">
            {item.signature ? (
              <SignatureCell signature={item.signature} />
            ) : null}
            <DetailCell
              label="Status"
              value={item.status.replaceAll("_", " ")}
            />
          </div>
        </div>
      </div>
      {item.signature ? (
        <div className="w-full shrink-0 bg-card px-5 pt-2 pb-4">
          <button
            className="t-hover flex h-12 w-full items-center justify-center rounded-full bg-foreground font-medium text-[16px] text-background leading-5 hover:-translate-y-0.5 hover:bg-foreground/90 active:translate-y-0"
            onClick={() =>
              openTrackedLink(publicEnv, {
                href: getExplorerTxUrl(item.signature ?? ""),
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
