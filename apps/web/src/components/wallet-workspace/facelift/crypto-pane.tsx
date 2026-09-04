"use client";

import type { TokenRow } from "@/components/wallet-sidebar/types";
import {
  ScrambledPopDigits,
  ScrambleText,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { SkeletonReveal } from "@/components/wallet-workspace/facelift/skeleton-reveal";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import {
  type ShieldedRow,
  ShieldedTokenIcon,
} from "@/components/wallet-workspace/facelift/unshield-pane";

const ASSET_BASE = "/wallet-workspace/facelift";

// The Stablecoins screen (Figma 4813:339437) is this same pane with a green
// stash tile, ticker subtitles, gray Swap and a black Earn action added.
export type CryptoPaneVariant = "crypto" | "stables";

export type CryptoRowActions = {
  onEarn?: (token: TokenRow) => void;
  onSelect?: (token: TokenRow) => void;
  onSend: (token: TokenRow) => void;
  onSwap: (token: TokenRow) => void;
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
    <p className="whitespace-nowrap text-right font-medium text-[16px] text-foreground leading-5">
      <ScrambleText isHidden={isHidden} text={whole} />
      <span className="text-tertiary">
        <ScrambleText isHidden={isHidden} text={fraction} />
      </span>
    </p>
  );
}

function formatChangeLabel(change: number): string {
  return `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
}

// Header action pill; label optionally collapses to icon-only when the pane
// is downsized (Figma 4813:339147 / 4813:339683).
function HeaderPill({
  hideLabel,
  icon,
  iconColorClass,
  isBlack,
  label,
  onClick,
}: {
  hideLabel?: boolean;
  icon: string;
  /** text-* class rendering the icon as a themed mask; omit = raw img. */
  iconColorClass?: string;
  isBlack?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`t-hover flex items-center justify-center gap-2 rounded-full p-2.5 hover:-translate-y-0.5 active:translate-y-0 ${
        isBlack
          ? "bg-foreground hover:bg-foreground/90"
          : "bg-accent hover:bg-accent-active"
      }`}
      onClick={onClick}
      type="button"
    >
      {iconColorClass ? (
        <ThemedIcon
          className={`size-6 ${iconColorClass}`}
          src={`${ASSET_BASE}/${icon}`}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          aria-hidden="true"
          className="size-6"
          src={`${ASSET_BASE}/${icon}`}
        />
      )}
      <span
        className={`whitespace-nowrap pr-2.5 font-medium text-[16px] leading-5 ${
          isBlack ? "text-background" : "text-foreground"
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
  iconColorClass,
  isBlack,
  label,
  onClick,
}: {
  icon: string;
  /** text-* class rendering the icon as a themed mask; omit = raw img. */
  iconColorClass?: string;
  isBlack?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex min-w-16 items-center justify-center rounded-[40px] px-4 py-2.5 font-medium text-[13px] leading-4 transition-colors max-[999px]:size-9 max-[999px]:min-w-0 max-[999px]:p-0 ${
        isBlack
          ? "bg-foreground text-background hover:bg-foreground/90"
          : "bg-accent text-foreground hover:bg-accent-active"
      }`}
      onClick={(event) => {
        // Don't bubble into the row click — below 1204px that would slide
        // the token detail sheet over the action pane being opened.
        event.stopPropagation();
        onClick();
      }}
      type="button"
    >
      <span className="max-[999px]:hidden">{label}</span>
      {iconColorClass ? (
        <ThemedIcon
          className={`hidden size-5 max-[999px]:block ${iconColorClass}`}
          label={label}
          src={`${ASSET_BASE}/${icon}`}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={label}
          className="hidden size-5 max-[999px]:block"
          src={`${ASSET_BASE}/${icon}`}
        />
      )}
    </button>
  );
}

// Figma 4813:338887..338935 — one asset row. Every row hover-reveals its
// action pills replacing the amounts (Send/Swap); the stables variant
// appends a black Earn pill and shows the ticker instead of price.
function TokenCell({
  actions,
  isBalanceHidden,
  row,
  variant,
}: {
  actions: CryptoRowActions;
  isBalanceHidden: boolean;
  row: TokenRow;
  variant: CryptoPaneVariant;
}) {
  const isStables = variant === "stables";
  return (
    // Row click selects the token for the detail right pane; the action
    // pills stop propagation (the page's row actions select the token
    // themselves without opening the <1204 detail sheet).
    <div
      className="group relative flex w-full cursor-pointer items-center rounded-2xl px-4 transition-colors duration-150 hover:bg-accent"
      onClick={() => actions.onSelect?.(row)}
    >
      <div className="flex shrink-0 items-center py-2 pr-3">
        <div className="relative size-11 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className="size-11 rounded-full object-cover"
            src={row.icon}
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
        <p className="truncate font-medium text-[16px] text-foreground leading-5 tracking-[-0.176px]">
          {row.name ?? row.symbol}
        </p>
        <p className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
          {isStables ? (
            row.symbol
          ) : (
            <>
              {`${row.price} `}
              {typeof row.priceChange24h === "number" ? (
                <span
                  className={
                    row.priceChange24h >= 0
                      ? "text-positive"
                      : "text-destructive"
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
            <p className="whitespace-nowrap text-right text-[13px] leading-4 text-muted-foreground">
              <ScrambleText
                isHidden={isBalanceHidden}
                text={`${row.amount} ${row.symbol}`}
              />
            </p>
          )}
        </div>
        {/* Reveal rides a short delay so quick pointer passes don't flash the
            buttons; un-hover drops the delay and hides immediately. */}
        <div className="pointer-events-none absolute right-0 flex items-center gap-2 rounded-[40px] bg-secondary opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-hover:delay-100">
          <RowPill
            icon="icon-arrow-up-circle.svg"
            iconColorClass="text-tertiary"
            label="Send"
            onClick={() => actions.onSend(row)}
          />
          <RowPill
            icon={
              isStables
                ? "icon-swap-repeat-gray.svg"
                : "icon-swap-repeat.svg"
            }
            iconColorClass={isStables ? "text-tertiary" : "text-background"}
            isBlack={!isStables}
            label="Swap"
            onClick={() => actions.onSwap(row)}
          />
          {isStables ? (
            <RowPill
              icon="icon-coins-add.svg"
              iconColorClass="text-background"
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

// A balance still held in the sunset private-transfer program, listed under
// the public assets so it is visible without opening the exit flow. Click
// opens Unshield with this token preselected.
function ShieldedCell({
  isBalanceHidden,
  onUnshield,
  row,
}: {
  isBalanceHidden: boolean;
  onUnshield: (mint: string) => void;
  row: ShieldedRow;
}) {
  return (
    <button
      className="group relative flex w-full cursor-pointer items-center rounded-2xl px-4 text-left transition-colors duration-150 hover:bg-accent"
      onClick={() => onUnshield(row.mint)}
      type="button"
    >
      <span className="flex shrink-0 items-center py-2 pr-3">
        <ShieldedTokenIcon icon={row.icon} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
        <span className="truncate font-medium text-[16px] text-foreground leading-5 tracking-[-0.176px]">
          {row.symbol}
        </span>
        <span className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
          <ScrambleText
            isHidden={isBalanceHidden}
            text={`${row.amountLabel} ${row.symbol} shielded`}
          />
        </span>
      </span>
      <span className="relative flex shrink-0 items-center justify-end pl-3">
        <span className="flex flex-col items-end justify-center gap-0.5 py-[11px] transition-opacity duration-150 group-hover:opacity-0">
          {row.valueLabel ? (
            <SplitUsd isHidden={isBalanceHidden} value={row.valueLabel} />
          ) : null}
        </span>
        <span className="pointer-events-none absolute right-0 flex items-center rounded-[40px] bg-secondary opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-100">
          <span className="flex min-w-16 items-center justify-center rounded-[40px] bg-foreground px-4 py-2.5 font-medium text-[13px] text-background leading-4">
            Unshield
          </span>
        </span>
      </span>
    </button>
  );
}

// Figma 4813:338844 (wide) / 4813:339148 (downsized) — the Crypto middle
// pane, and via variant="stables" the Stablecoins one (4813:339437 /
// 4813:339683): header actions, the stash balance cell, then the asset list.
export function CryptoPane({
  balanceFraction,
  balanceWhole,
  isBalanceRevealed,
  onBack,
  onEarn,
  onSend,
  onSwap,
  onUnshield,
  rowActions,
  shieldedRows = [],
  tokenRows,
  variant,
}: {
  balanceFraction: string;
  balanceWhole: string;
  isBalanceRevealed: boolean;
  onBack: () => void;
  onEarn?: () => void;
  onSend: () => void;
  onSwap: () => void;
  /** Exit path for legacy shielded balances; only passed when the wallet holds some. */
  onUnshield?: (mint?: string) => void;
  rowActions: CryptoRowActions;
  /** Balances still held in the private-transfer program, listed under the assets. */
  shieldedRows?: ShieldedRow[];
  tokenRows: TokenRow[];
  variant: CryptoPaneVariant;
}) {
  const { isBalanceHidden } = useBalanceVisibility();
  const isStables = variant === "stables";

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <section className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto rounded-3xl bg-card max-[795px]:rounded-none">
        <header className="flex w-full shrink-0 items-center p-2">
          {/* Mobile (Figma 4813:365930 / 4813:366091) — a pushed screen: back
              arrow to the wallet home, no header pills. */}
          <div className="hidden shrink-0 items-center pr-3 max-[795px]:flex">
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
          <div className="flex min-w-0 flex-1 items-center py-2.5 pl-4 max-[795px]:pl-0">
            <h1 className="truncate whitespace-nowrap font-semibold text-[20px] text-foreground leading-6">
              {isStables ? "Stablecoins" : "Crypto"}
            </h1>
          </div>
          <div className="flex shrink-0 items-start gap-2 pl-3 max-[795px]:hidden">
            {onUnshield ? (
              <HeaderPill
                hideLabel
                icon="icon-withdraw-arrow.svg"
                iconColorClass="text-tertiary"
                label="Unshield"
                onClick={() => onUnshield()}
              />
            ) : null}
            <HeaderPill
              hideLabel
              icon="icon-arrow-up-circle.svg"
              iconColorClass="text-tertiary"
              label="Send"
              onClick={onSend}
            />
            <HeaderPill
              hideLabel={isStables}
              icon={
                isStables ? "icon-swap-repeat-gray.svg" : "icon-swap-repeat.svg"
              }
              iconColorClass={isStables ? "text-tertiary" : "text-background"}
              isBlack={!isStables}
              label="Swap"
              onClick={onSwap}
            />
            {isStables && onEarn ? (
              <HeaderPill
                hideLabel
                icon="icon-coins-add.svg"
                iconColorClass="text-background"
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
              <p className="whitespace-nowrap text-[16px] leading-5 text-muted-foreground">
                Balance
              </p>
              <p className="whitespace-nowrap font-semibold text-[40px] text-foreground leading-[48px] tracking-[-0.44px]">
                <SkeletonReveal
                  isRevealed={isBalanceRevealed}
                  skeletonClassName="rounded-lg bg-accent-selected"
                >
                  {isBalanceRevealed ? (
                    <ScrambledPopDigits
                      isHidden={isBalanceHidden}
                      segments={[
                        { text: balanceWhole },
                        { color: "var(--tertiary)", text: balanceFraction },
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
          {tokenRows.map((row) => (
            <TokenCell
              actions={rowActions}
              isBalanceHidden={isBalanceHidden}
              key={row.id ?? row.symbol}
              row={row}
              variant={variant}
            />
          ))}
          {onUnshield && shieldedRows.length > 0 ? (
            <>
              <p className="px-4 pt-4 pb-2 font-semibold text-[16px] text-foreground leading-5">
                Shielded
              </p>
              {shieldedRows.map((row) => (
                <ShieldedCell
                  isBalanceHidden={isBalanceHidden}
                  key={row.mint}
                  onUnshield={onUnshield}
                  row={row}
                />
              ))}
            </>
          ) : null}
        </div>
      </section>

      {/* Mobile action bar (Figma 4813:366048 / 4813:366180) — the header
          pills' actions pinned under the list; same trio on both variants. */}
      <div className="hidden w-full shrink-0 gap-2 bg-card px-4 pt-2 pb-4 max-[795px]:flex">
        <button
          className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-foreground p-2.5"
          onClick={onSwap}
          type="button"
        >
          <ThemedIcon
            className="size-6 text-background"
            src={`${ASSET_BASE}/icon-swap-repeat.svg`}
          />
          <span className="whitespace-nowrap pr-2.5 font-medium text-[16px] text-background leading-5">
            Swap
          </span>
        </button>
        <button
          className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-secondary p-2.5"
          onClick={onSend}
          type="button"
        >
          <ThemedIcon
            className="size-6 text-tertiary"
            src={`${ASSET_BASE}/icon-arrow-up-circle.svg`}
          />
          <span className="whitespace-nowrap pr-2.5 font-medium text-[16px] text-foreground leading-5">
            Send
          </span>
        </button>
        {onUnshield ? (
          <button
            className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-secondary p-2.5"
            onClick={() => onUnshield()}
            type="button"
          >
            <ThemedIcon
              className="size-6 text-tertiary"
              src={`${ASSET_BASE}/icon-withdraw-arrow.svg`}
            />
            <span className="whitespace-nowrap pr-2.5 font-medium text-[16px] text-foreground leading-5">
              Unshield
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
