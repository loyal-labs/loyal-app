"use client";

import { useState } from "react";

import type { TransactionDetail } from "@/components/wallet-sidebar/types";
import { copyTextToClipboard } from "@/components/wallet-workspace/facelift/copy-text";
import { usePublicEnv } from "@/contexts/public-env-context";
import { openTrackedLink } from "@/lib/core/analytics";
import { getTokenIconUrl } from "@/lib/token-icon";

const ASSET_BASE = "/wallet-workspace/facelift";

// Swap rows carry both legs (from the raw activity) so the detail can show
// the two-line hero and the rate — the mapped ActivityRow keeps only one.
export type TransactionSwapDetail = {
  fromAmount: string;
  fromSymbol: string;
  fromIcon: string;
  toAmount: string;
  toSymbol: string;
  toIcon: string;
  rate: string | null;
};

type DetailKind =
  | "sent"
  | "received"
  | "swap"
  | "earn_deposit"
  | "earn_withdraw"
  | "shielded"
  | "unshielded";

const KIND_TITLES: Record<DetailKind, string> = {
  earn_deposit: "Deposited",
  earn_withdraw: "Withdrawn",
  received: "Received",
  sent: "Sent",
  shielded: "Shielded",
  swap: "Swapped",
  unshielded: "Unshielded",
};

function truncateAddress(addr: string): string {
  if (addr.length <= 12) {
    return addr;
  }
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function resolveKind(
  detail: TransactionDetail,
  swap: TransactionSwapDetail | undefined
): DetailKind {
  if (swap) {
    return "swap";
  }
  const override = detail.activity.titleOverride;
  if (override === "Earn Deposit") {
    return "earn_deposit";
  }
  if (override === "Earn Withdrawal") {
    return "earn_withdraw";
  }
  if (detail.activity.type === "shielded") {
    return "shielded";
  }
  if (detail.activity.type === "unshielded") {
    return "unshielded";
  }
  return detail.activity.type === "sent" ? "sent" : "received";
}

// One From/To style row (Figma "Cell"): 44px tile, 13px label, 16px value.
function RouteRow({
  copyValue,
  icon,
  label,
  value,
  valueSuffix,
}: {
  copyValue?: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  valueSuffix?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex h-[60px] w-full items-center rounded-2xl px-4">
      <div className="flex shrink-0 items-center py-2 pr-3">{icon}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
        <p className="text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
          {label}
        </p>
        <p className="truncate font-medium text-[16px] text-black leading-5">
          {value}
          {valueSuffix ? (
            <span className="text-[#b1b1b4]"> · {valueSuffix}</span>
          ) : null}
        </p>
      </div>
      {copyValue ? (
        <button
          aria-label={`Copy ${label.toLowerCase()} address`}
          className="t-hover flex shrink-0 items-center justify-center pl-3"
          onClick={() => {
            void copyTextToClipboard(copyValue).then((didCopy) => {
              if (didCopy) {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }
            });
          }}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-6"
            src={`${ASSET_BASE}/${copied ? "icon-check.svg" : "icon-copy.svg"}`}
          />
        </button>
      ) : null}
    </div>
  );
}

function WalletTile() {
  return (
    <span className="flex size-11 items-center justify-center rounded-[11px] bg-black/[0.04]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        aria-hidden="true"
        className="h-[19px] w-[25px]"
        src={`${ASSET_BASE}/icon-wallet-fill.svg`}
      />
    </span>
  );
}

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex w-full flex-col gap-0.5 px-4 py-[11px]">
      <p className="text-[13px] leading-4 text-[#8a8a8e]">{label}</p>
      <p className="text-[16px] text-black leading-5 tracking-[-0.176px]">
        {value}
      </p>
    </div>
  );
}

// Facelift transaction detail (Figma 4880:74020 Sent, 4879:68721 Received,
// 4880:74295 Swapped, 4879:69018 Deposited, 4880:74343 Withdrawn,
// 4880:74400 Shielded, 4880:74481 Unshielded): identity in the header,
// amount hero, From/To route rows, fee card, Solscan button pinned bottom.
export function TransactionDetailPane({
  detail,
  onClose,
  swap,
  walletAddress,
}: {
  detail: TransactionDetail;
  onClose: () => void;
  swap?: TransactionSwapDetail;
  walletAddress: string | null;
}) {
  const publicEnv = usePublicEnv();
  const kind = resolveKind(detail, swap);
  const row = detail.activity;
  const title = swap ? "Swapped" : row.titleOverride ?? KIND_TITLES[kind];
  const isPrivate = detail.isPrivate || row.isPrivate;
  const isShieldKind = kind === "shielded" || kind === "unshielded";
  const isEarnKind = kind === "earn_deposit" || kind === "earn_withdraw";

  // "+1,010.22 USDC" → sign-stripped number + symbol for the hero.
  const rawAmount = row.amount.replace(/^[+−-]/, "");
  const amountParts = rawAmount.split(" ");
  const amountNumber = amountParts[0];
  const amountSymbol = amountParts.slice(1).join(" ");
  // Shield rows keep the legacy shield art as row.icon — the detail wants
  // the token image, so re-derive it from the amount's symbol.
  const tokenIcon = isShieldKind ? getTokenIconUrl(amountSymbol) : row.icon;

  const ownAddress = walletAddress ? truncateAddress(walletAddress) : null;
  const solscanUrl = `https://solscan.io/tx/${row.id}${
    publicEnv.solanaEnv === "mainnet"
      ? ""
      : `?cluster=${publicEnv.solanaEnv === "devnet" ? "devnet" : "custom"}`
  }`;

  const earnTile = (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" aria-hidden="true" className="size-11" src={`${ASSET_BASE}/earn-icon.svg`} />
  );
  const stablecoinsTile = (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" aria-hidden="true" className="size-11" src={`${ASSET_BASE}/stash-stablecoins.svg`} />
  );
  const stablecoinsRow = (label: string) => (
    <RouteRow
      icon={stablecoinsTile}
      label={label}
      value="Stablecoins"
      valueSuffix={ownAddress ?? undefined}
    />
  );
  const earnRow = (label: string) => (
    <RouteRow icon={earnTile} label={label} value="Earn" />
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="flex w-full shrink-0 items-center p-2">
        <div className="flex shrink-0 items-center pr-3">
          {swap ? (
            <span className="relative block size-11">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                className="absolute top-0 left-0 size-[30px] rounded-full object-cover"
                src={swap.fromIcon}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                className="absolute right-0 bottom-0 size-[30px] rounded-full object-cover"
                src={swap.toIcon}
              />
            </span>
          ) : isShieldKind ? (
            <span className="relative block size-11">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                className="absolute top-0 left-0 size-[30px] rounded-full object-cover"
                src={tokenIcon}
              />
              {kind === "shielded" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="absolute right-px bottom-px size-7"
                  src={`${ASSET_BASE}/icon-shield-badge.svg`}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="-scale-x-100 absolute right-px bottom-px h-7 w-auto max-w-none"
                  src={`${ASSET_BASE}/icon-unshield-badge.svg`}
                />
              )}
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              className="size-11 rounded-full object-cover"
              src={tokenIcon}
            />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate font-semibold text-[20px] text-black leading-6 tracking-[-0.22px]">
            {title}
          </h2>
          <p className="truncate text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
            {row.date}, {row.timestamp}
          </p>
        </div>
        <button
          aria-label="Close transaction details"
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
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto">
        <div className="w-full p-2">
          <div className="flex w-full flex-col gap-0.5 px-4 pt-[30px] pb-2">
            {swap ? (
              <>
                <p className="whitespace-nowrap font-semibold text-[40px] text-black leading-[48px] tracking-[-0.44px]">
                  −{swap.fromAmount}{" "}
                  <span className="text-[#b1b1b4] text-[28px] leading-8 tracking-[-0.308px]">
                    {swap.fromSymbol}
                  </span>
                </p>
                <p className="whitespace-nowrap font-semibold text-[#34c759] text-[40px] leading-[48px] tracking-[-0.44px]">
                  +{swap.toAmount}{" "}
                  <span className="text-[#b1b1b4] text-[28px] leading-8 tracking-[-0.308px]">
                    {swap.toSymbol}
                  </span>
                </p>
              </>
            ) : (
              <p
                className={`whitespace-nowrap font-semibold text-[40px] leading-[48px] tracking-[-0.44px] ${
                  kind === "received" ? "text-[#34c759]" : "text-black"
                }`}
              >
                {isShieldKind || isEarnKind
                  ? ""
                  : kind === "received"
                  ? "+"
                  : "−"}
                {amountNumber}{" "}
                <span className="text-[#b1b1b4] text-[28px] leading-8 tracking-[-0.308px]">
                  {amountSymbol}
                </span>
              </p>
            )}
            <p className="text-[16px] leading-5 text-[rgba(60,60,67,0.6)]">
              {detail.usdValue}
            </p>
          </div>
        </div>
        {kind === "sent" || kind === "received" ? (
          <div className="w-full px-2 pb-2">
            <RouteRow
              copyValue={row.counterparty}
              icon={<WalletTile />}
              label={kind === "sent" ? "To" : "From"}
              value={truncateAddress(row.counterparty)}
            />
          </div>
        ) : isEarnKind ? (
          <div className="relative w-full px-2 pb-2">
            {kind === "earn_deposit" ? (
              <>
                {stablecoinsRow("From")}
                {earnRow("To")}
              </>
            ) : (
              <>
                {earnRow("From")}
                {stablecoinsRow("To")}
              </>
            )}
            {/* Connector between the two 60px route rows. */}
            <span className="absolute top-[54px] left-[45px] h-3 w-0.5 rounded-xl bg-[#d9d9d9]" />
          </div>
        ) : null}
        <div className="w-full p-2">
          <div className="flex w-full flex-col rounded-2xl bg-black/[0.04]">
            {detail.status === "Failed" ? (
              <DetailCell label="Status" value="Failed" />
            ) : null}
            {swap?.rate ? <DetailCell label="Rate" value={swap.rate} /> : null}
            <DetailCell
              label="Network Fee"
              value={`${detail.networkFee} ~ ${detail.networkFeeUsd}`}
            />
          </div>
        </div>
      </div>
      {isPrivate ? null : (
        <div className="w-full shrink-0 bg-white px-5 pt-2 pb-4">
          <button
            className="t-hover flex h-12 w-full items-center justify-center rounded-full bg-black font-medium text-[16px] text-white leading-5 hover:-translate-y-0.5 hover:bg-[#171717] active:translate-y-0"
            onClick={() =>
              openTrackedLink(publicEnv, {
                href: solscanUrl,
                linkText: "View on Solscan",
                source: "transaction_detail",
              })
            }
            type="button"
          >
            View on Solscan
          </button>
        </div>
      )}
    </div>
  );
}
