"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  ScrambleText,
  useBalanceVisibility,
} from "@/components/wallet-workspace/facelift/balance-visibility";
import { SplitUsd } from "@/components/wallet-workspace/facelift/crypto-pane";
import { PopDigits } from "@/components/wallet-workspace/facelift/pop-digits";
import { SkeletonReveal } from "@/components/wallet-workspace/facelift/skeleton-reveal";
import { ThemedIcon } from "@/components/wallet-workspace/facelift/themed-icon";
import { splitUsdBalance } from "@/hooks/use-wallet-desktop-data";

const ASSET_BASE = "/wallet-workspace/facelift";

type ChartPoint = { priceUsd: number; timestamp: number };

// Client mirror of the /api/tokens/[mint] payload — the server response type
// lives in a server-only module and can't be imported here.
type TokenDetail = {
  chart: ChartPoint[];
  info: {
    description: string | null;
    gtVerified: boolean;
    holderDistribution: { top10: string } | null;
  };
  links: {
    discord: string | null;
    explorer: string | null;
    telegram: string | null;
    twitter: string | null;
    website: string | null;
  };
  market: {
    fdvUsd: number | null;
    holderCount: number | null;
    liquidityUsd: number | null;
    marketCapUsd: number | null;
    priceChange24hPercent: number | null;
    priceUsd: number | null;
    volume24hUsd: number | null;
  };
  token: { logoUrl: string | null; name: string | null; symbol: string | null };
};

const CHART_RANGES = [
  { days: "1", label: "1D" },
  { days: "7", label: "1W" },
  { days: "30", label: "1M" },
  { days: "365", label: "1Y" },
  { days: "max", label: "Max" },
] as const;

type ChartRangeLabel = (typeof CHART_RANGES)[number]["label"];

// Session caches so re-selecting a token doesn't refetch (the server caches
// CoinGecko for 5 minutes too).
const DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const detailCache = new Map<string, { savedAt: number; value: TokenDetail }>();
const chartRangeCache = new Map<
  string,
  { points: ChartPoint[]; savedAt: number }
>();

function formatPrice(value: number): string {
  if (value >= 1) {
    return `$${value.toLocaleString("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    })}`;
  }
  const trimmed = value
    .toFixed(6)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
  return `$${trimmed}`;
}

function splitPrice(value: number): { fraction: string; whole: string } {
  const text = formatPrice(value);
  const dotIndex = text.indexOf(".");
  return dotIndex >= 0
    ? { fraction: text.slice(dotIndex), whole: text.slice(0, dotIndex) }
    : { fraction: "", whole: text };
}

function formatCompactUsd(value: number): string {
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`;
  }
  return `$${value.toFixed(2)}`;
}

function formatCompactCount(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toLocaleString("en-US");
}

function formatTokenBalance(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

// Hourly ranges show the time of day; daily ones the date.
function formatPointTime(timestamp: number, range: ChartRangeLabel): string {
  const date = new Date(timestamp);
  if (range === "1D" || range === "1W") {
    return date.toLocaleString("en-US", {
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
    });
  }
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function normalizeChartPoints(points: ChartPoint[]): ChartPoint[] {
  return points
    .filter(
      (point) =>
        Number.isFinite(point.priceUsd) &&
        point.priceUsd > 0 &&
        Number.isFinite(point.timestamp)
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

// Polyline in a 100×44 stretched viewBox (the OG token-detail projection),
// plus the min/max labels and every point's y ratio so the scrub dot can
// ride the line.
function buildChartGeometry(points: ChartPoint[]) {
  if (points.length < 2) {
    return null;
  }

  const width = 100;
  const height = 44;
  const verticalPadding = 2;
  const prices = points.map((point) => point.priceUsd);
  let min = Math.min(...prices);
  let max = Math.max(...prices);

  if (Math.abs(max - min) < Number.EPSILON) {
    const midpoint = (min + max) / 2 || 1;
    const visualRange = Math.max(Math.abs(midpoint) * 0.002, 0.000001);
    min = midpoint - visualRange / 2;
    max = midpoint + visualRange / 2;
  }

  const range = max - min;
  const toY = (price: number) =>
    height -
    ((price - min) / range) * (height - verticalPadding * 2) -
    verticalPadding;
  const line = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${toY(
        point.priceUsd
      ).toFixed(2)}`;
    })
    .join(" ");

  return {
    line,
    maxPrice: max,
    minPrice: min,
    yRatios: points.map((point) => toY(point.priceUsd) / height),
  };
}

function CircleActionButton({
  icon,
  iconColorClass,
  label,
  onClick,
}: {
  icon: string;
  /** text-* class rendering the icon as a themed mask; omit = raw img. */
  iconColorClass?: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="t-hover flex items-center justify-center rounded-full bg-accent p-2.5 hover:-translate-y-0.5 hover:bg-accent-active active:translate-y-0"
      onClick={onClick}
      type="button"
    >
      {iconColorClass ? (
        <ThemedIcon className={`size-6 ${iconColorClass}`} src={icon} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" aria-hidden="true" className="size-6" src={icon} />
      )}
    </button>
  );
}

function BalanceRow({
  amountLabel,
  icon,
  isBalanceHidden,
  title,
  valueUsd,
}: {
  amountLabel: string;
  icon: string;
  isBalanceHidden: boolean;
  title: string;
  valueUsd: number;
}) {
  return (
    <div className="flex w-full items-center px-4">
      <div className="flex shrink-0 items-center py-2 pr-3">
        <span className="relative size-11 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className="size-11 rounded-full object-cover"
            src={icon}
          />
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-[11px]">
        <p className="truncate font-medium text-[16px] text-foreground leading-5 tracking-[-0.176px]">
          {title}
        </p>
        <p className="whitespace-nowrap text-[13px] leading-4 text-muted-foreground">
          <ScrambleText isHidden={isBalanceHidden} text={amountLabel} />
        </p>
      </div>
      <div className="flex shrink-0 items-center justify-end py-[11px] pl-3">
        <SplitUsd
          isHidden={isBalanceHidden}
          value={`$${valueUsd.toLocaleString("en-US", {
            maximumFractionDigits: 2,
            minimumFractionDigits: 2,
          })}`}
        />
      </div>
    </div>
  );
}

function LinkChip({
  href,
  icon,
  label,
}: {
  href: string;
  icon: string;
  label: string;
}) {
  return (
    <a
      className="t-hover flex shrink-0 items-center gap-1 rounded-xl bg-secondary py-2 pr-3 pl-2 hover:bg-accent-active"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      <ThemedIcon
        className="size-5 text-tertiary"
        src={`${ASSET_BASE}/${icon}`}
      />
      <span className="whitespace-nowrap font-medium text-[15px] text-foreground leading-5 tracking-[-0.165px]">
        {label}
      </span>
    </a>
  );
}

// Figma 4826:439625 — the Crypto/Stablecoins right pane: market header +
// price, range chart, stats chips, the wallet's balance with quick actions,
// then the About block with link chips.
// Market data rides the OG /api/tokens/[mint] CoinGecko proxy. Passing
// onClose renders the <1204 sheet variant (Figma 4826:440136): X in the
// header and the actions pinned in a bottom bar instead of inline.
export function TokenDetailPane({
  hideChart,
  icon,
  mint,
  name,
  onClose,
  onSend,
  onSwap,
  price,
  publicBalance,
  symbol,
}: {
  /** Stablecoins skip the price chart — a flat $1 line is just noise. */
  hideChart?: boolean;
  icon: string;
  mint: string;
  name: string;
  onClose?: () => void;
  onSend: () => void;
  onSwap: () => void;
  price: number;
  publicBalance: number;
  symbol: string;
}) {
  const isSheet = Boolean(onClose);
  const { isBalanceHidden } = useBalanceVisibility();
  const cachedDetail = detailCache.get(mint);
  const [detail, setDetail] = useState<TokenDetail | null>(
    cachedDetail && Date.now() - cachedDetail.savedAt < DETAIL_CACHE_TTL_MS
      ? cachedDetail.value
      : null
  );
  const [hasDetailError, setHasDetailError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [activeRange, setActiveRange] = useState<ChartRangeLabel>("1D");
  const [rangeCharts, setRangeCharts] = useState<
    Partial<Record<ChartRangeLabel, ChartPoint[]>>
  >({});

  useEffect(() => {
    const cached = detailCache.get(mint);
    if (cached && Date.now() - cached.savedAt < DETAIL_CACHE_TTL_MS) {
      return;
    }

    let cancelled = false;
    setHasDetailError(false);
    void fetch(`/api/tokens/${encodeURIComponent(mint)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: TokenDetail | null) => {
        if (cancelled) {
          return;
        }
        if (!payload) {
          setHasDetailError(true);
          return;
        }
        detailCache.set(mint, { savedAt: Date.now(), value: payload });
        setDetail(payload);
      })
      .catch(() => {
        if (!cancelled) {
          setHasDetailError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mint, retryNonce]);

  // Non-24h ranges fetch their chart on first visit; 1D reuses the detail's.
  useEffect(() => {
    const range = CHART_RANGES.find((entry) => entry.label === activeRange);
    if (!range || range.label === "1D") {
      return;
    }

    const cacheKey = `${mint}:${range.days}`;
    const cached = chartRangeCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < DETAIL_CACHE_TTL_MS) {
      setRangeCharts((current) => ({
        ...current,
        [range.label]: cached.points,
      }));
      return;
    }

    let cancelled = false;
    void fetch(
      `/api/tokens/${encodeURIComponent(mint)}?chartDays=${range.days}`
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { chart?: ChartPoint[] } | null) => {
        if (cancelled) {
          return;
        }
        const points = Array.isArray(payload?.chart) ? payload.chart : [];
        chartRangeCache.set(cacheKey, { points, savedAt: Date.now() });
        setRangeCharts((current) => ({ ...current, [range.label]: points }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeRange, mint]);

  const chartPoints =
    activeRange === "1D"
      ? detail?.chart ?? null
      : rangeCharts[activeRange] ?? null;
  const normalizedPoints = useMemo(
    () => (chartPoints ? normalizeChartPoints(chartPoints) : null),
    [chartPoints]
  );
  const geometry = useMemo(
    () => (normalizedPoints ? buildChartGeometry(normalizedPoints) : null),
    [normalizedPoints]
  );

  // Scrubbing: the dot rides the line under the cursor and the big price
  // shows that point; resting state parks the dot on the latest point.
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const lastIndex = normalizedPoints ? normalizedPoints.length - 1 : 0;
  const activeIndex = Math.min(hoveredIndex ?? lastIndex, lastIndex);
  const hoveredPoint =
    hoveredIndex !== null && normalizedPoints
      ? normalizedPoints[activeIndex] ?? null
      : null;
  const handleChartPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = chartAreaRef.current?.getBoundingClientRect();
    if (!bounds || !normalizedPoints || normalizedPoints.length < 2) {
      return;
    }
    const ratio = Math.min(
      Math.max((event.clientX - bounds.left) / bounds.width, 0),
      1
    );
    setHoveredIndex(Math.round(ratio * (normalizedPoints.length - 1)));
  };

  const priceChange = detail?.market.priceChange24hPercent ?? null;
  const isNegative = priceChange !== null && priceChange < 0;
  const chartColor = isNegative ? "var(--destructive)" : "var(--positive)";
  const displayPrice = detail?.market.priceUsd ?? price;
  const priceParts = splitPrice(hoveredPoint?.priceUsd ?? displayPrice);
  // The pop-in mounts once the real price is known (or the fetch settled),
  // so the entrance plays on the actual value — scrub updates render plain.
  const isPriceRevealed = detail !== null || hasDetailError || price > 0;

  const statChips = useMemo(() => {
    if (!detail) {
      return [];
    }
    const top10 = detail.info.holderDistribution
      ? Number.parseFloat(detail.info.holderDistribution.top10)
      : null;
    const chips: { label: string; value: string }[] = [];
    if (detail.market.marketCapUsd !== null) {
      chips.push({
        label: "MCAP",
        value: formatCompactUsd(detail.market.marketCapUsd),
      });
    }
    if (detail.market.volume24hUsd !== null) {
      chips.push({
        label: "24H VOL",
        value: formatCompactUsd(detail.market.volume24hUsd),
      });
    }
    if (detail.market.liquidityUsd !== null) {
      chips.push({
        label: "LIQ",
        value: formatCompactUsd(detail.market.liquidityUsd),
      });
    }
    if (detail.market.holderCount !== null) {
      chips.push({
        label: "HLDRS",
        value: formatCompactCount(detail.market.holderCount),
      });
    }
    if (top10 !== null && Number.isFinite(top10)) {
      chips.push({ label: "TOP10", value: `${top10.toFixed(2)}%` });
    }
    if (detail.market.fdvUsd !== null) {
      chips.push({
        label: "FDV",
        value: formatCompactUsd(detail.market.fdvUsd),
      });
    }
    return chips;
  }, [detail]);

  const linkChips = useMemo(() => {
    const chips: { href: string; icon: string; label: string }[] = [];
    if (detail?.links.website) {
      chips.push({
        href: detail.links.website,
        icon: "icon-globe.svg",
        label: detail.links.website
          .replace(/^https?:\/\//, "")
          .replace(/^www\./, "")
          .replace(/\/$/, ""),
      });
    }
    if (detail?.links.twitter) {
      const handle = detail.links.twitter.split("/").filter(Boolean).pop();
      chips.push({
        href: detail.links.twitter,
        icon: "icon-x-social.svg",
        label: handle ? `@${handle}` : "X",
      });
    }
    if (detail?.links.discord) {
      chips.push({
        href: detail.links.discord,
        icon: "icon-discord.svg",
        label: "Discord",
      });
    }
    if (detail?.links.telegram) {
      chips.push({
        href: detail.links.telegram,
        icon: "icon-globe.svg",
        label: "Telegram",
      });
    }
    chips.push({
      href: detail?.links.explorer ?? `https://solscan.io/token/${mint}`,
      icon: "icon-arrow-up-right-circle.svg",
      label: "Solscan",
    });
    return chips;
  }, [detail, mint]);

  const totalBalanceUsd = publicBalance * price;
  const balanceParts = splitUsdBalance(totalBalanceUsd);
  const hasPublic = publicBalance > 0;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex w-full shrink-0 items-center p-2">
        <div className="flex shrink-0 items-center pr-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className="size-11 rounded-full object-cover"
            src={icon}
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 py-2.5">
          <h2 className="truncate font-semibold text-[20px] text-foreground leading-6">
            {symbol}
          </h2>
          {detail?.info.gtVerified ? (
            <ThemedIcon
              className="size-6 shrink-0 text-positive"
              label="Verified"
              src={`${ASSET_BASE}/icon-verified.svg`}
            />
          ) : null}
        </div>
        {onClose ? (
          <button
            aria-label="Close"
            className="t-hover flex size-11 shrink-0 items-center justify-center rounded-3xl hover:bg-accent"
            onClick={onClose}
            type="button"
          >
            <ThemedIcon
              className="size-6 text-muted-foreground"
              src={`${ASSET_BASE}/icon-cross.svg`}
            />
          </button>
        ) : null}
      </header>

      <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto">
        <div className={`w-full shrink-0 ${isSheet ? "py-2" : "p-2"}`}>
          <div className="flex h-[86px] w-full items-center rounded-[20px] px-4 py-2">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="truncate text-[16px] leading-5 text-muted-foreground">
                {name}
              </p>
              <div className="flex items-baseline gap-3">
                <p className="whitespace-nowrap font-semibold text-[40px] text-foreground leading-[48px] tracking-[-0.44px]">
                  <SkeletonReveal
                    isRevealed={isPriceRevealed}
                    skeletonClassName="rounded-lg bg-accent-selected"
                  >
                    {isPriceRevealed ? (
                      <PopDigits
                        popOnChange={false}
                        segments={[
                          { text: priceParts.whole },
                          {
                            color: "var(--tertiary)",
                            text: priceParts.fraction,
                          },
                        ]}
                      />
                    ) : (
                      `${priceParts.whole}${priceParts.fraction}`
                    )}
                  </SkeletonReveal>
                </p>
                {priceChange !== null ? (
                  <p
                    className="whitespace-nowrap text-[16px] leading-5"
                    style={{ color: chartColor }}
                  >
                    {`${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(2)}%`}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {hideChart ? null : (
          <div className="flex w-full shrink-0 flex-col pb-4">
            <div className="flex w-full items-center justify-between px-4 pb-1">
              {/* Hovered point's datetime rides the chart's top row (the empty
                space left of the max label), so it can't shift the layout. */}
              <p
                className={`min-h-4 text-[12px] leading-4 text-muted-foreground transition-opacity duration-150 ${
                  hoveredPoint ? "opacity-100" : "opacity-0"
                }`}
              >
                {hoveredPoint
                  ? formatPointTime(hoveredPoint.timestamp, activeRange)
                  : " "}
              </p>
              <p className="min-h-4 text-[12px] leading-4 text-muted-foreground">
                {geometry ? formatPrice(geometry.maxPrice) : " "}
              </p>
            </div>
            <div className="relative h-[200px] w-full pr-4">
              {geometry && normalizedPoints ? (
                // Re-keyed per chart so token/range switches replay the draw.
                <div
                  className="relative h-full w-full cursor-crosshair [touch-action:none]"
                  key={`${mint}:${activeRange}`}
                  onPointerCancel={() => setHoveredIndex(null)}
                  onPointerLeave={() => setHoveredIndex(null)}
                  onPointerMove={handleChartPointerMove}
                  ref={chartAreaRef}
                >
                  <svg
                    aria-label="Price chart"
                    className="token-chart-line block h-full w-full overflow-visible"
                    preserveAspectRatio="none"
                    role="img"
                    viewBox="0 0 100 44"
                  >
                    <path
                      d={geometry.line}
                      fill="none"
                      stroke={chartColor}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.8}
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  {/* The veil dims the line past the active point; the dot
                    rides the line there (cursor x, or the latest point). */}
                  <span
                    aria-hidden="true"
                    className="token-chart-trail absolute inset-y-0 right-0 bg-card/60"
                    style={{
                      left: `${(activeIndex / Math.max(lastIndex, 1)) * 100}%`,
                    }}
                  />
                  <span
                    aria-hidden="true"
                    className="token-chart-dot -translate-x-1/2 -translate-y-1/2 absolute size-3 rounded-full border-2 border-card"
                    style={{
                      backgroundColor: chartColor,
                      left: `${(activeIndex / Math.max(lastIndex, 1)) * 100}%`,
                      top: `${(geometry.yRatios[activeIndex] ?? 0.5) * 100}%`,
                    }}
                  />
                  <style jsx>{`
                    /* Left→right clip reveal; a stroke-dash draw is off the
                     table here — non-scaling-stroke computes dashes in
                     screen space, which shreds the line into fragments. */
                    .token-chart-line {
                      animation: token-chart-reveal 0.9s
                        cubic-bezier(0.2, 0, 0, 1) both;
                    }

                    .token-chart-trail,
                    .token-chart-dot {
                      animation: token-chart-fade 0.25s ease-out 0.8s both;
                    }

                    @keyframes token-chart-reveal {
                      from {
                        clip-path: inset(0 100% 0 0);
                      }
                      to {
                        clip-path: inset(0 0 0 0);
                      }
                    }

                    @keyframes token-chart-fade {
                      from {
                        opacity: 0;
                      }
                      to {
                        opacity: 1;
                      }
                    }

                    @media (prefers-reduced-motion: reduce) {
                      .token-chart-line,
                      .token-chart-trail,
                      .token-chart-dot {
                        animation: none;
                      }
                    }
                  `}</style>
                </div>
              ) : hasDetailError && !detail ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3">
                  <p className="text-[13px] leading-4 text-muted-foreground">
                    Couldn&apos;t load market data.
                  </p>
                  <button
                    className="t-hover rounded-full bg-accent px-4 py-2.5 font-medium text-[13px] text-foreground leading-4 hover:bg-accent-active"
                    onClick={() => setRetryNonce((nonce) => nonce + 1)}
                    type="button"
                  >
                    Retry
                  </button>
                </div>
              ) : chartPoints ? (
                <div className="flex h-full w-full items-center justify-center">
                  <p className="text-[13px] leading-4 text-muted-foreground">
                    No price history yet.
                  </p>
                </div>
              ) : (
                <div className="h-full w-full pl-4">
                  <div className="h-full w-full animate-pulse rounded-2xl bg-accent" />
                </div>
              )}
            </div>
            <div className="flex w-full items-center justify-end px-4 pt-1">
              <p className="min-h-4 text-[13px] leading-4 text-muted-foreground">
                {geometry ? formatPrice(geometry.minPrice) : " "}
              </p>
            </div>
            <div className="flex w-full items-center gap-2 px-4 pt-2">
              {CHART_RANGES.map((range) => (
                <button
                  className={`flex min-w-0 flex-1 items-center justify-center rounded-full px-3 py-2.5 font-medium text-[13px] leading-4 transition-colors ${
                    activeRange === range.label
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  key={range.label}
                  onClick={() => setActiveRange(range.label)}
                  type="button"
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {statChips.length > 0 ? (
          <div className="w-full shrink-0 py-2">
            <div className="flex w-full gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {statChips.map((chip) => (
                <div
                  className="flex shrink-0 flex-col justify-center rounded-xl bg-secondary px-3 py-2"
                  key={chip.label}
                >
                  <p className="text-[13px] leading-4 text-muted-foreground">
                    {chip.label}
                  </p>
                  <p className="whitespace-nowrap font-medium text-[16px] text-foreground leading-5 tracking-[-0.176px]">
                    {chip.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div
          className={`flex w-full shrink-0 flex-col ${
            isSheet ? "py-2" : "p-2"
          }`}
        >
          <div className="flex w-full flex-col gap-0.5 px-4 py-2">
            <p className="text-[16px] leading-5 text-muted-foreground">Balance</p>
            <p className="whitespace-nowrap font-semibold text-[32px] text-foreground leading-9">
              <ScrambleText
                isHidden={isBalanceHidden}
                text={balanceParts.balanceWhole}
              />
              <span className="text-tertiary">
                <ScrambleText
                  isHidden={isBalanceHidden}
                  text={balanceParts.balanceFraction}
                />
              </span>
            </p>
            <p className="whitespace-nowrap text-[16px] leading-5 text-muted-foreground">
              <ScrambleText
                isHidden={isBalanceHidden}
                text={`${formatTokenBalance(publicBalance)} ${symbol}`}
              />
            </p>
          </div>
          {isSheet ? null : (
            <div className="flex w-full items-center gap-2 py-2 pl-3">
              <button
                className="t-hover flex items-center justify-center gap-2 rounded-full bg-foreground p-2.5 hover:-translate-y-0.5 hover:bg-foreground/90 active:translate-y-0"
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
              <CircleActionButton
                icon={`${ASSET_BASE}/icon-arrow-up-circle.svg`}
                iconColorClass="text-tertiary"
                label="Send"
                onClick={onSend}
              />
            </div>
          )}
          {hasPublic ? (
            <div className="relative flex w-full flex-col">
              <BalanceRow
                amountLabel={`${formatTokenBalance(publicBalance)} ${symbol}`}
                icon={icon}
                isBalanceHidden={isBalanceHidden}
                title="Public"
                valueUsd={publicBalance * price}
              />
            </div>
          ) : null}
        </div>

        <div
          className={`flex w-full shrink-0 flex-col ${isSheet ? "" : "px-2"}`}
        >
          <div className="flex w-full items-start px-4 pt-1">
            <p className="min-w-0 flex-1 pt-3 pb-2 font-semibold text-[16px] text-foreground leading-5 tracking-[-0.176px]">
              About
            </p>
          </div>
          {detail?.info.description ? (
            <p className="px-4 pb-2 text-[13px] leading-4 text-muted-foreground">
              {detail.info.description}
            </p>
          ) : null}
          <div className="flex w-full flex-wrap items-start gap-2 px-4 pt-2 pb-4">
            {linkChips.map((chip) => (
              <LinkChip
                href={chip.href}
                icon={chip.icon}
                key={chip.label}
                label={chip.label}
              />
            ))}
          </div>
        </div>
      </div>

      {isSheet ? (
        // Sheet variant pins the actions under the scroll area (Figma
        // 4834:440680): labeled Swap/Send pills.
        <div className="flex w-full shrink-0 items-center gap-2 bg-card px-4 pt-2 pb-4">
          <button
            className="flex shrink-0 items-center justify-center gap-2 rounded-full bg-foreground p-2.5"
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
        </div>
      ) : null}
    </div>
  );
}
