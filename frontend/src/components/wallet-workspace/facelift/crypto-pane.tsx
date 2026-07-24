"use client";

import type { TokenRow } from "@/components/wallet-sidebar/types";
import {
  ScrambledPopDigits,
  ScrambleText,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { SkeletonReveal } from "@/components/wallet-workspace/facelift/skeleton-reveal";

const ASSET_BASE = "/wallet-workspace/facelift";

// The Stablecoins screen (Figma 4813:339437) is this same pane with a green
// stash tile, ticker subtitles, gray Swap and a black Earn action added.
export type CryptoPaneVariant = "crypto" | "stables";

export type CryptoRowActions = {
  onEarn?: (token: TokenRow) => void;
  onSelect?: (token: TokenRow) => void;
  onSend: (token: TokenRow) => void;
  onShield: (token: TokenRow) => void;
  onSwap: (token: TokenRow) => void;
  onUnshield: (token: TokenRow) => void;
};

// $9,884.55 → black whole + gray fraction, scrambled while hidden.
export function SplitUsd({
  isHidden,
  value,
}: {
  isHidden: boolean;
  value: string;
}) {
  const dotIndex = value.lastIndexOf(".");
  const whole = dotIndex >= 0 ? value.slice(0, dotIndex) : value;
  const fraction = dotIndex >= 0 ? value.slice(dotIndex) : "";
  return (
    <p className="whitespace-nowrap text-right font-medium text-[16px] text-black leading-5">
      <ScrambleText isHidden={isHidden} text={whole} />
      <span className="text-[#b1b1b4]">
        <ScrambleText isHidden={isHidden} text={fraction} />
      </span>
    </p>
  );
}

function formatChangeLabel(change: number): string {
  return `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}

function getPairKey(row: TokenRow): string {
  return (row.id?.replace(/-secured$/, "") ?? row.symbol).toLowerCase();
}

// Header action pill; label optionally collapses to icon-only when the pane
// is downsized (Figma 4813:339147 / 4813:339683).
function HeaderPill({
  hideLabel,
  icon,
  isBlack,
  label,
  onClick,
}: {
  hideLabel?: boolean;
  icon: string;
  isBlack?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`t-hover flex items-center justify-center gap-2 rounded-full p-2.5 hover:-translate-y-0.5 active:translate-y-0 ${
        isBlack
          ? "bg-black hover:bg-[#171717]"
          : "bg-black/[0.04] hover:bg-black/[0.08]"
      }`}
      onClick={onClick}
      type="button"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        aria-hidden="true"
        className="size-6"
        src={`${ASSET_BASE}/${icon}`}
      />
      <span
        className={`whitespace-nowrap pr-2.5 font-medium text-[16px] leading-5 ${
          isBlack ? "text-white" : "text-black"
        }${hideLabel ? " max-[999px]:hidden" : ""}`}
      >
        {label}
      </span>
    </button>
  );
}

// Hover-revealed row action: label pill wide, icon circle when downsized.
function RowPill({
  icon,
  isBlack,
  label,
  onClick,
}: {
  icon: string;
  isBlack?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex min-w-16 items-center justify-center rounded-[40px] px-4 py-2.5 font-medium text-[13px] leading-4 transition-colors max-[999px]:size-9 max-[999px]:min-w-0 max-[999px]:p-0 ${
        isBlack
          ? "bg-black text-white hover:bg-[#171717]"
          : "bg-black/[0.04] text-black hover:bg-black/[0.08]"
      }`}
      onClick={onClick}
      type="button"
    >
      <span className="max-[999px]:hidden">{label}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={label}
        className="hidden size-5 max-[999px]:block"
        src={`${ASSET_BASE}/${icon}`}
      />
    </button>
  );
}

// Figma 4813:338887..338935 — one asset row. Every row hover-reveals its
// action pills replacing the amounts: public rows Shield/Send/Swap, shielded
// rows Unshield/Send/Swap plus the badge and "· Shielded" suffix; the stables
// variant appends a black Earn pill and shows the ticker instead of price.
function TokenCell({
  actions,
  isBalanceHidden,
  isPairFirst,
  row,
  variant,
}: {
  actions: CryptoRowActions;
  isBalanceHidden: boolean;
  isPairFirst: boolean;
  row: TokenRow;
  variant: CryptoPaneVariant;
}) {
  const isStables = variant === "stables";
  return (
    // Row click selects the token for the detail right pane; the action
    // pills' clicks bubbling into the selection is intentional.
    <div
      className="group relative flex w-full cursor-pointer items-center rounded-2xl px-4 transition-colors duration-150 hover:bg-black/[0.04]"
      onClick={() => actions.onSelect?.(row)}
    >
      {isPairFirst ? (
        <span
          aria-hidden="true"
          className="-bottom-1.5 absolute left-[37px] z-10 h-3 w-0.5 rounded-full bg-[#d9d9d9]"
        />
      ) : null}
      <div className="flex shrink-0 items-center py-2 pr-3">
        <div className="relative size-11 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className="size-11 rounded-full object-cover"
            src={row.icon}
          />
          {row.isSecured ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="Shielded"
              className="-bottom-0.5 -right-[3px] absolute size-5"
              src={`${ASSET_BASE}/icon-shield-badge.svg`}
            />
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
        <p className="truncate font-medium text-[16px] text-black leading-5 tracking-[-0.176px]">
          {row.name ?? row.symbol}
          {row.isSecured ? (
            <span className="text-[#b1b1b4]">{" · Shielded"}</span>
          ) : null}
        </p>
        <p className="whitespace-nowrap text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
          {isStables ? (
            row.symbol
          ) : (
            <>
              {`${row.price} `}
              {typeof row.priceChange24h === "number" ? (
                <span
                  className={
                    row.priceChange24h >= 0
                      ? "text-[#34c759]"
                      : "text-[#f9363c]"
                  }
                >
                  {formatChangeLabel(row.priceChange24h)}
                </span>
              ) : null}
            </>
          )}
        </p>
      </div>
      <div className="relative flex shrink-0 items-center justify-end pl-3">
        <div className="group-hover:pointer-events-none flex flex-col items-end justify-center gap-0.5 py-[11px] transition-opacity duration-150 group-hover:opacity-0">
          <SplitUsd isHidden={isBalanceHidden} value={row.value} />
          {isStables ? null : (
            <p className="whitespace-nowrap text-right text-[13px] leading-4 text-[rgba(60,60,67,0.6)]">
              <ScrambleText
                isHidden={isBalanceHidden}
                text={`${row.amount} ${row.symbol}`}
              />
            </p>
          )}
        </div>
        {/* Reveal rides a short delay so quick pointer passes don't flash the
            buttons; un-hover drops the delay and hides immediately. */}
        <div className="pointer-events-none absolute right-0 flex items-center gap-2 rounded-[40px] bg-[#f5f5f5] opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-hover:delay-100">
          {row.isSecured ? (
            <RowPill
              icon="icon-shield-break.svg"
              label="Unshield"
              onClick={() => actions.onUnshield(row)}
            />
          ) : (
            <RowPill
              icon="icon-shield.svg"
              label="Shield"
              onClick={() => actions.onShield(row)}
            />
          )}
          <RowPill
            icon="icon-arrow-up-circle.svg"
            label="Send"
            onClick={() => actions.onSend(row)}
          />
          <RowPill
            icon={
              isStables ? "icon-swap-repeat-gray.svg" : "icon-swap-repeat.svg"
            }
            isBlack={!isStables}
            label="Swap"
            onClick={() => actions.onSwap(row)}
          />
          {isStables ? (
            <RowPill
              icon="icon-coins-add.svg"
              isBlack
              label="Earn"
              onClick={() => actions.onEarn?.(row)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Figma 4813:338844 (wide) / 4813:339148 (downsized) — the Crypto middle
// pane, and via variant="stables" the Stablecoins one (4813:339437 /
// 4813:339683): header actions, the stash balance cell, then the asset list
// with public/shielded pairs joined by a connector.
export function CryptoPane({
  balanceFraction,
  balanceWhole,
  isBalanceRevealed,
  onBack,
  onEarn,
  onSend,
  onShield,
  onSwap,
  rowActions,
  tokenRows,
  variant,
}: {
  balanceFraction: string;
  balanceWhole: string;
  isBalanceRevealed: boolean;
  onBack: () => void;
  onEarn?: () => void;
  onSend: () => void;
  onShield: () => void;
  onSwap: () => void;
  rowActions: CryptoRowActions;
  tokenRows: TokenRow[];
  variant: CryptoPaneVariant;
}) {
  const { isBalanceHidden } = useBalanceVisibility();
  const isStables = variant === "stables";

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <section className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto rounded-3xl bg-white max-[795px]:rounded-none">
        <header className="flex w-full shrink-0 items-center p-2">
          {/* Mobile (Figma 4813:365930 / 4813:366091) — a pushed screen: back
              arrow to the wallet home, no header pills. */}
          <div className="hidden shrink-0 items-center pr-3 max-[795px]:flex">
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
          <div className="flex min-w-0 flex-1 items-center py-2.5 pl-4 max-[795px]:pl-0">
            <h1 className="truncate whitespace-nowrap font-semibold text-[20px] text-black leading-6">
              {isStables ? "Stablecoins" : "Crypto"}
            </h1>
          </div>
          <div className="flex shrink-0 items-start gap-2 pl-3 max-[795px]:hidden">
            <HeaderPill
              hideLabel
              icon="icon-shield.svg"
              label="Shield"
              onClick={onShield}
            />
            <HeaderPill
              hideLabel
              icon="icon-arrow-up-circle.svg"
              label="Send"
              onClick={onSend}
            />
            <HeaderPill
              hideLabel={isStables}
              icon={
                isStables ? "icon-swap-repeat-gray.svg" : "icon-swap-repeat.svg"
              }
              isBlack={!isStables}
              label="Swap"
              onClick={onSwap}
            />
            {isStables && onEarn ? (
              <HeaderPill
                hideLabel
                icon="icon-coins-add.svg"
                isBlack
                label="Earn"
                onClick={onEarn}
              />
            ) : null}
          </div>
        </header>

        <div className="w-full shrink-0 p-2">
          <div className="flex h-[86px] w-full items-center rounded-[20px] px-3 py-2">
            <div className="flex shrink-0 items-center py-[3px] pr-3">
              {isStables ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  aria-hidden="true"
                  className="size-16"
                  src={`${ASSET_BASE}/stash-stablecoins.svg`}
                />
              ) : (
                // Figma "Stash" tile — three white bars on purple.
                <span className="relative block size-16 overflow-clip rounded-2xl bg-[#9946fc]">
                  <span className="absolute top-8 left-[10.67px] h-[21.33px] w-2 rounded-[2.667px] bg-white" />
                  <span className="absolute top-[10.67px] left-7 h-[42.67px] w-2 rounded-[2.667px] bg-white" />
                  <span className="absolute top-[21.33px] left-[45.33px] h-8 w-2 rounded-[2.667px] bg-white" />
                </span>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="whitespace-nowrap text-[16px] leading-5 text-[rgba(60,60,67,0.6)]">
                Balance
              </p>
              <p className="whitespace-nowrap font-semibold text-[40px] text-black leading-[48px] tracking-[-0.44px]">
                <SkeletonReveal
                  isRevealed={isBalanceRevealed}
                  skeletonClassName="rounded-lg bg-black/[0.06]"
                >
                  {isBalanceRevealed ? (
                    <ScrambledPopDigits
                      isHidden={isBalanceHidden}
                      segments={[
                        { text: balanceWhole },
                        { color: "#b1b1b4", text: balanceFraction },
                      ]}
                    />
                  ) : (
                    `${balanceWhole}${balanceFraction}`
                  )}
                </SkeletonReveal>
              </p>
            </div>
          </div>
        </div>

        <div className="flex w-full flex-1 flex-col p-2">
          {tokenRows.map((row, index) => {
            const next = tokenRows[index + 1];
            const isPairFirst =
              row.isSecured !== true &&
              next?.isSecured === true &&
              getPairKey(next) === getPairKey(row);
            return (
              <TokenCell
                actions={rowActions}
                isBalanceHidden={isBalanceHidden}
                isPairFirst={isPairFirst}
                key={row.id ?? row.symbol}
                row={row}
                variant={variant}
              />
            );
          })}
        </div>
      </section>

      {/* Mobile action bar (Figma 4813:366048 / 4813:366180) — the header
          pills' actions pinned under the list; same trio on both variants. */}
      <div className="hidden w-full shrink-0 gap-2 bg-white px-4 pt-2 pb-4 max-[795px]:flex">
        <button
          className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-black p-2.5"
          onClick={onSwap}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-6"
            src={`${ASSET_BASE}/icon-swap-repeat.svg`}
          />
          <span className="whitespace-nowrap pr-2.5 font-medium text-[16px] text-white leading-5">
            Swap
          </span>
        </button>
        <button
          className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-[#f5f5f5] p-2.5"
          onClick={onSend}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-6"
            src={`${ASSET_BASE}/icon-arrow-up-circle.svg`}
          />
          <span className="whitespace-nowrap pr-2.5 font-medium text-[16px] text-black leading-5">
            Send
          </span>
        </button>
        <button
          className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-black/[0.04] p-2.5"
          onClick={onShield}
          type="button"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            aria-hidden="true"
            className="size-6"
            src={`${ASSET_BASE}/icon-shield.svg`}
          />
          <span className="whitespace-nowrap pr-2.5 font-medium text-[16px] text-black leading-5">
            Shield
          </span>
        </button>
      </div>
    </div>
  );
}
