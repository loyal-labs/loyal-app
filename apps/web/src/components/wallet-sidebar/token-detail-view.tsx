"use client";

import {
  ArrowLeft,
  ExternalLink,
  Globe,
  Shield,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import type { TokenRow } from "./types";

type TokenDetailChartPoint = {
  timestamp: number;
  priceUsd: number;
};

type TokenDetailData = {
  mint: string;
  token: {
    decimals: number | null;
    logoUrl: string | null;
    name: string | null;
    symbol: string | null;
  };
  links: {
    website: string | null;
    twitter: string | null;
    explorer: string | null;
    discord: string | null;
    telegram: string | null;
  };
  market: {
    fdvUsd: number | null;
    holderCount: number | null;
    liquidityUsd: number | null;
    marketCapUsd: number | null;
    priceChange24hPercent: number | null;
    priceUsd: number | null;
    updatedAt: string | null;
    volume24hUsd: number | null;
  };
  info: {
    description: string | null;
    gtScore: number | null;
    gtVerified: boolean;
    mintAuthority: string | null;
    freezeAuthority: string | null;
    holderDistribution: {
      top10: string;
      rest: string;
    } | null;
  };
  chart: TokenDetailChartPoint[];
};

const FONT = "var(--font-geist-sans), sans-serif";
const COLOR_PRIMARY = "#000";
const COLOR_SECONDARY = "rgba(60, 60, 67, 0.6)";
const COLOR_GREEN = "#34C759";
const COLOR_RED = "#FF3B30";
const COLOR_ORANGE = "#FF9500";
const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";

const labelStyle: React.CSSProperties = {
  color: COLOR_SECONDARY,
  fontFamily: FONT,
  fontSize: "13px",
  fontWeight: 500,
  lineHeight: "16px",
};

const sectionTitleStyle: React.CSSProperties = {
  color: COLOR_PRIMARY,
  fontFamily: FONT,
  fontSize: "18px",
  fontWeight: 600,
  letterSpacing: "-0.18px",
  lineHeight: "24px",
};

const valueStyle: React.CSSProperties = {
  color: COLOR_PRIMARY,
  fontFamily: FONT,
  fontSize: "14px",
  fontWeight: 500,
  lineHeight: "20px",
};

async function fetchTokenDetail(mint: string): Promise<TokenDetailData> {
  const response = await fetch(`/api/tokens/${encodeURIComponent(mint)}`);

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Failed to load token data");
  }

  return response.json() as Promise<TokenDetailData>;
}

function formatUsd(value: number | null): string {
  if (value === null) return "-";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toPrecision(4)}`;
}

function formatPrice(value: number | null): string {
  if (value === null) return "-";
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toPrecision(4)}`;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatNumber(value: number | null): string {
  if (value === null) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("en-US");
}

function formatChartTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function parseTokenAmount(amount: string): number {
  return Number.parseFloat(amount.replace(/,/g, "")) || 0;
}

function hasDisplayBalance(amount: string | null | undefined): boolean {
  if (!amount) return false;
  return parseTokenAmount(amount) > 0;
}

function buildChartPath(points: TokenDetailChartPoint[]) {
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
  const coordinates = points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const rawY =
      height -
      ((point.priceUsd - min) / range) * (height - verticalPadding * 2) -
      verticalPadding;
    const y = Math.min(
      Math.max(rawY, verticalPadding),
      height - verticalPadding
    );

    return { x, y };
  });
  const line = coordinates
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    )
    .join(" ");

  return {
    area: `${line} L ${width} ${height} L 0 ${height} Z`,
    coordinates,
    line,
  };
}

function normalizeChartPoints(points: TokenDetailChartPoint[]) {
  return points
    .map((point) => {
      const priceUsd = Number(point.priceUsd);
      const timestamp = Number(point.timestamp);

      if (
        !Number.isFinite(priceUsd) ||
        priceUsd <= 0 ||
        !Number.isFinite(timestamp)
      ) {
        return null;
      }

      return { priceUsd, timestamp };
    })
    .filter((point): point is TokenDetailChartPoint => point !== null)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function TokenChart({
  color,
  points,
}: {
  color: string;
  points: TokenDetailChartPoint[];
}) {
  const gradientId = useId().replace(/:/g, "");
  const chartRef = useRef<SVGSVGElement | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const chartPoints = useMemo(
    () => normalizeChartPoints(points),
    [points]
  );
  const paths = useMemo(() => buildChartPath(chartPoints), [chartPoints]);
  const hoveredPoint =
    hoveredIndex !== null ? chartPoints[hoveredIndex] ?? null : null;
  const hoveredCoordinate =
    hoveredIndex !== null ? paths?.coordinates[hoveredIndex] ?? null : null;

  if (!paths) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div
          style={{
            alignItems: "center",
            background: "rgba(0, 0, 0, 0.025)",
            borderRadius: "18px",
            color: COLOR_SECONDARY,
            display: "flex",
            fontFamily: FONT,
            fontSize: "13px",
            justifyContent: "center",
            lineHeight: "18px",
            minHeight: "140px",
            padding: "0 16px",
            textAlign: "center",
          }}
        >
          No price history from CoinGecko yet.
        </div>
      </div>
    );
  }

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = chartRef.current?.getBoundingClientRect();

    if (!bounds || chartPoints.length < 2) return;

    const x = Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width);
    const index = Math.round((x / bounds.width) * (chartPoints.length - 1));
    setHoveredIndex(Math.min(Math.max(index, 0), chartPoints.length - 1));
  };
  const markerX =
    hoveredIndex === null || chartPoints.length < 2
      ? null
      : (hoveredIndex / (chartPoints.length - 1)) * 100;

  return (
    <div
      style={{
        padding: "6px 0 0",
      }}
    >
      <div
        aria-hidden={!hoveredPoint}
        style={{
          color: COLOR_PRIMARY,
          fontFamily: FONT,
          fontSize: "15px",
          fontWeight: 600,
          lineHeight: "20px",
          opacity: hoveredPoint ? 1 : 0,
          padding: "0 0 8px",
          textAlign: "center",
          transition: "opacity 0.12s ease",
        }}
      >
        {hoveredPoint ? formatPrice(hoveredPoint.priceUsd) : "$0.00"}
      </div>
      <div
        style={{
          height: "190px",
          position: "relative",
          width: "100%",
        }}
      >
        <svg
          aria-label="24 hour price chart"
          height={190}
          onPointerLeave={() => setHoveredIndex(null)}
          onPointerMove={handlePointerMove}
          preserveAspectRatio="none"
          ref={chartRef}
          role="img"
          style={{
            cursor: "crosshair",
            display: "block",
            height: "100%",
            overflow: "visible",
            touchAction: "none",
            width: "100%",
          }}
          viewBox="0 0 100 44"
          width="100%"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={paths.area} fill={`url(#${gradientId})`} />
          <path
            d={paths.line}
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.4"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {markerX !== null && hoveredPoint && hoveredCoordinate && (
          <div
            aria-hidden="true"
            style={{
              inset: 0,
              pointerEvents: "none",
              position: "absolute",
            }}
          >
            <span
              style={{
                background: "rgba(0, 0, 0, 0.16)",
                bottom: 0,
                left: `${markerX}%`,
                position: "absolute",
                top: 0,
                transform: "translateX(-0.5px)",
                width: "1px",
              }}
            />
            <span
              style={{
                background: color,
                border: "2px solid #fff",
                borderRadius: "9999px",
                boxSizing: "border-box",
                height: "14px",
                left: `${markerX}%`,
                position: "absolute",
                top: `${(hoveredCoordinate.y / 44) * 100}%`,
                transform: "translate(-50%, -50%)",
                width: "14px",
              }}
            />
          </div>
        )}
      </div>
      <div
        style={{
          color: COLOR_SECONDARY,
          fontFamily: FONT,
          fontSize: "12px",
          lineHeight: "16px",
          minHeight: "16px",
          padding: "0 0 2px",
          textAlign: "center",
        }}
      >
        {hoveredPoint
          ? formatChartTime(hoveredPoint.timestamp)
          : "Last 24 hours"}
      </div>
    </div>
  );
}

export function TokenDetailView({
  token,
  onBack,
}: {
  token: TokenRow;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<TokenDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mint = token.id?.replace(/-secured$/, "") ?? null;

  const loadDetail = useCallback(async () => {
    if (!mint) {
      setError("No token address available");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchTokenDetail(mint);
      setDetail(data);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Failed to load token data"
      );
    } finally {
      setLoading(false);
    }
  }, [mint]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const priceChange =
    detail?.market.priceChange24hPercent ??
    (detail && detail.chart.length >= 2
      ? ((detail.chart[detail.chart.length - 1].priceUsd -
          detail.chart[0].priceUsd) /
          detail.chart[0].priceUsd) *
        100
      : null);
  const changeColor =
    priceChange === null
      ? COLOR_SECONDARY
      : priceChange >= 0
      ? COLOR_GREEN
      : COLOR_RED;
  const chartColor =
    priceChange === null || priceChange >= 0 ? COLOR_GREEN : COLOR_RED;
  const totalAmount = token.totalAmountDisplay ?? token.amount;
  const totalValue = token.totalValueDisplay ?? token.value;
  const publicAmount = token.publicAmountDisplay;
  const publicValue = token.publicValueDisplay;
  const securedAmount = token.securedAmountDisplay;
  const securedValue = token.securedValueDisplay;
  const hasAnyBalance = hasDisplayBalance(totalAmount);
  const isNativeSol = mint === NATIVE_SOL_MINT && token.symbol === "SOL";
  const displayName = isNativeSol
    ? "Solana"
    : detail?.token.name ?? token.name ?? token.symbol;
  const displaySymbol = isNativeSol
    ? "SOL"
    : detail?.token.symbol ?? token.symbol;
  const displayIcon = isNativeSol
    ? token.icon
    : detail?.token.logoUrl ?? token.icon;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        position: "relative",
      }}
    >
      <style jsx>{`
        @keyframes token-detail-shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }

        .token-detail-skeleton {
          background: rgba(0, 0, 0, 0.055);
          border-radius: 9999px;
          overflow: hidden;
          position: relative;
        }

        .token-detail-skeleton::after {
          animation: token-detail-shimmer 1.4s ease-in-out infinite;
          background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.7),
            transparent
          );
          content: "";
          inset: 0;
          position: absolute;
          transform: translateX(-100%);
        }

        .token-detail-button:active {
          transform: scale(0.98);
        }

        .token-detail-back:hover {
          background: rgba(0, 0, 0, 0.08) !important;
        }

        .token-detail-retry:hover {
          background: rgba(0, 0, 0, 0.82) !important;
        }

        .token-detail-link:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }

        .token-detail-scroll::-webkit-scrollbar {
          width: 0;
          height: 0;
        }

        .token-detail-scroll {
          scrollbar-width: none;
        }
      `}</style>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "flex-end",
          padding: "8px",
          pointerEvents: "none",
          position: "absolute",
          right: 0,
          top: 0,
          zIndex: 2,
        }}
      >
        <button
          className="token-detail-button token-detail-back"
          onClick={onBack}
          style={{
            alignItems: "center",
            background: "rgba(0, 0, 0, 0.04)",
            border: "none",
            borderRadius: "9999px",
            color: "#3C3C43",
            cursor: "pointer",
            display: "flex",
            height: "36px",
            justifyContent: "center",
            pointerEvents: "auto",
            transition: "background 0.2s ease, transform 0.15s ease",
            width: "36px",
          }}
          type="button"
        >
          <ArrowLeft size={24} />
        </button>
      </div>

      {loading && (
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            gap: "18px",
            minHeight: 0,
            padding: "44px 20px 24px",
          }}
        >
          <div style={{ alignItems: "center", display: "flex", gap: "14px" }}>
            <div
              className="token-detail-skeleton"
              style={{ borderRadius: "18px", height: "72px", width: "72px" }}
            />
            <div
              style={{
                display: "flex",
                flex: 1,
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div
                className="token-detail-skeleton"
                style={{ height: "18px", width: "46%" }}
              />
              <div
                className="token-detail-skeleton"
                style={{ height: "42px", width: "70%" }}
              />
              <div
                className="token-detail-skeleton"
                style={{ height: "18px", width: "34%" }}
              />
            </div>
          </div>
          <div
            className="token-detail-skeleton"
            style={{ borderRadius: "22px", height: "218px", width: "100%" }}
          />
          <div
            className="token-detail-skeleton"
            style={{ borderRadius: "18px", height: "132px", width: "100%" }}
          />
          <div
            className="token-detail-skeleton"
            style={{ borderRadius: "18px", height: "112px", width: "100%" }}
          />
        </div>
      )}

      {error && !loading && (
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flex: 1,
            flexDirection: "column",
            gap: "12px",
            justifyContent: "center",
            padding: "0 20px",
          }}
        >
          <div
            style={{
              alignItems: "center",
              background: "rgba(0, 0, 0, 0.025)",
              borderRadius: "18px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              maxWidth: "360px",
              padding: "22px",
              width: "100%",
            }}
          >
            <span
              style={{
                color: COLOR_PRIMARY,
                fontFamily: FONT,
                fontSize: "18px",
                fontWeight: 600,
                lineHeight: "24px",
              }}
            >
              Token data unavailable
            </span>
            <p
              style={{
                color: COLOR_SECONDARY,
                fontFamily: FONT,
                fontSize: "14px",
                lineHeight: "20px",
                margin: 0,
                textAlign: "center",
              }}
            >
              {error}
            </p>
            <button
              className="token-detail-button token-detail-retry"
              onClick={() => void loadDetail()}
              style={{
                background: "#111",
                border: "none",
                borderRadius: "9999px",
                color: "#fff",
                cursor: "pointer",
                fontFamily: FONT,
                fontSize: "14px",
                fontWeight: 500,
                padding: "10px 22px",
                transition: "background 0.15s ease, transform 0.15s ease",
              }}
              type="button"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {detail && !loading && (
        <div
          className="token-detail-scroll"
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            gap: "30px",
            minHeight: 0,
            overflowX: "hidden",
            overflowY: "auto",
            padding: "44px 20px 24px",
          }}
        >
          <div
            style={{
              alignItems: "center",
              display: "flex",
              gap: "14px",
              padding: "0 0 4px",
            }}
          >
            <div
              style={{
                borderRadius: "20px",
                flexShrink: 0,
                height: "72px",
                position: "relative",
                width: "72px",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={displaySymbol}
                src={displayIcon}
                style={{
                  borderRadius: "20px",
                  height: "100%",
                  objectFit: "cover",
                  width: "100%",
                }}
              />
              {token.isSecured && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    src="/hero-new/Shield_40.svg"
                    style={{
                      bottom: "-4px",
                      height: "30px",
                      position: "absolute",
                      right: "-4px",
                      width: "30px",
                    }}
                  />
                </>
              )}
            </div>
            <div
              style={{
                display: "flex",
                flex: 1,
                flexDirection: "column",
                gap: "4px",
                minWidth: 0,
              }}
            >
              <span
                style={{
                  color: COLOR_SECONDARY,
                  fontFamily: FONT,
                  fontSize: "14px",
                  fontWeight: 500,
                  lineHeight: "18px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {displayName}
              </span>
              <span
                style={{
                  color: COLOR_PRIMARY,
                  fontFamily: FONT,
                  fontSize: "40px",
                  fontWeight: 600,
                  letterSpacing: "-0.44px",
                  lineHeight: "46px",
                }}
              >
                {formatPrice(detail.market.priceUsd)}
              </span>
              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                {priceChange !== null && (
                  <span
                    style={{
                      color: changeColor,
                      fontFamily: FONT,
                      fontSize: "13px",
                      fontWeight: 600,
                      lineHeight: "16px",
                    }}
                  >
                    {formatPercent(priceChange)} 24h
                  </span>
                )}
                {typeof token.apyBps === "number" && token.apyBps > 0 && (
                  <span
                    style={{
                      alignItems: "center",
                      background: "rgba(52, 199, 89, 0.12)",
                      borderRadius: "9999px",
                      color: "#2EA043",
                      display: "inline-flex",
                      fontFamily: FONT,
                      fontSize: "12px",
                      fontWeight: 600,
                      gap: "4px",
                      lineHeight: "16px",
                      padding: "4px 8px",
                    }}
                  >
                    <Shield size={12} />
                    {(token.apyBps / 100).toFixed(2)}% APY
                  </span>
                )}
              </div>
            </div>
          </div>

          <TokenChart color={chartColor} points={detail.chart} />

          {hasAnyBalance && (
            <BalanceSection
              apyBps={token.apyBps}
              icon={displayIcon}
              publicAmount={publicAmount}
              publicValue={publicValue}
              securedAmount={securedAmount}
              securedValue={securedValue}
              symbol={token.symbol}
              totalAmount={totalAmount}
              totalValue={totalValue}
            />
          )}

          <section style={{ display: "flex", flexDirection: "column" }}>
            <span
              style={{
                ...sectionTitleStyle,
                display: "block",
                marginBottom: "10px",
              }}
            >
              Market
            </span>
            <div
              style={{
                display: "grid",
                borderTop: "1px solid rgba(0, 0, 0, 0.06)",
                gridTemplateColumns: "1fr 1fr",
              }}
            >
              <StatItem
                label="Market cap"
                value={formatUsd(detail.market.marketCapUsd)}
              />
              <StatItem label="FDV" value={formatUsd(detail.market.fdvUsd)} />
              <StatItem
                label="Liquidity"
                value={formatUsd(detail.market.liquidityUsd)}
              />
              <StatItem
                label="Volume 24h"
                value={formatUsd(detail.market.volume24hUsd)}
              />
            </div>
          </section>

          <section
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <span style={sectionTitleStyle}>Security</span>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              <SecurityBadge
                tone={detail.info.gtVerified ? "green" : "orange"}
                label={detail.info.gtVerified ? "Verified token" : "Unverified token"}
              />
              <SecurityBadge
                tone={detail.info.mintAuthority === "no" ? "green" : "orange"}
                label={
                  detail.info.mintAuthority === "no"
                    ? "Mint authority disabled"
                    : "Mint authority enabled"
                }
              />
              <SecurityBadge
                tone={detail.info.freezeAuthority === "no" ? "green" : "orange"}
                label={
                  detail.info.freezeAuthority === "no"
                    ? "Freeze authority disabled"
                    : "Freeze authority enabled"
                }
              />
            </div>

            {detail.info.gtScore !== null && (
              <div
                style={{ display: "flex", flexDirection: "column", gap: "8px" }}
              >
                <div
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <span style={labelStyle}>
                    Score
                  </span>
                  <span style={{ ...valueStyle, fontSize: "13px" }}>
                    {detail.info.gtScore.toFixed(1)} / 100
                  </span>
                </div>
                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.06)",
                    borderRadius: "2px",
                    height: "4px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      background:
                        detail.info.gtScore >= 70
                          ? COLOR_GREEN
                          : detail.info.gtScore >= 40
                          ? COLOR_ORANGE
                          : COLOR_RED,
                      borderRadius: "2px",
                      height: "100%",
                      width: `${Math.min(detail.info.gtScore, 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </section>

          {(detail.market.holderCount !== null ||
            detail.info.holderDistribution) && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div
                style={{
                  alignItems: "baseline",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span style={sectionTitleStyle}>Ownership</span>
                {detail.market.holderCount !== null && (
                  <span style={valueStyle}>
                    {formatNumber(detail.market.holderCount)}
                  </span>
                )}
              </div>
              {detail.info.holderDistribution && (
                <>
                  <div
                    style={{
                      alignItems: "center",
                      display: "flex",
                      gap: "8px",
                    }}
                  >
                    <div
                      style={{
                        background: "rgba(0, 0, 0, 0.06)",
                        borderRadius: "4px",
                        display: "flex",
                        flex: 1,
                        height: "8px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          background: COLOR_ORANGE,
                          borderRadius: "4px 0 0 4px",
                          width: `${Number.parseFloat(
                            detail.info.holderDistribution.top10
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div
                    style={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <span style={{ ...labelStyle, fontSize: "12px" }}>
                      Top 10:{" "}
                      {Number.parseFloat(
                        detail.info.holderDistribution.top10
                      ).toFixed(1)}
                      %
                    </span>
                    <span style={{ ...labelStyle, fontSize: "12px" }}>
                      Rest:{" "}
                      {Number.parseFloat(
                        detail.info.holderDistribution.rest
                      ).toFixed(1)}
                      %
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {(detail.links.website ||
            detail.links.twitter ||
            detail.links.discord ||
            detail.links.telegram ||
            detail.links.explorer) && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
              }}
            >
              <span style={{ ...sectionTitleStyle, marginBottom: "8px" }}>
                Links
              </span>
              {detail.links.website && (
                <LinkRow
                  href={detail.links.website}
                  icon={<Globe size={16} style={{ color: COLOR_SECONDARY }} />}
                  label={detail.links.website
                    .replace(/^https?:\/\//, "")
                    .replace(/\/$/, "")}
                />
              )}
              {detail.links.twitter && (
                <LinkRow
                  href={detail.links.twitter}
                  icon={<XIcon />}
                  label="X"
                />
              )}
              {detail.links.discord && (
                <LinkRow
                  href={detail.links.discord}
                  icon={<Globe size={16} style={{ color: COLOR_SECONDARY }} />}
                  label="Discord"
                />
              )}
              {detail.links.telegram && (
                <LinkRow
                  href={detail.links.telegram}
                  icon={<Globe size={16} style={{ color: COLOR_SECONDARY }} />}
                  label="Telegram"
                />
              )}
              {detail.links.explorer && (
                <LinkRow
                  href={detail.links.explorer}
                  icon={<Globe size={16} style={{ color: COLOR_SECONDARY }} />}
                  label="Solscan"
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BalanceSection({
  apyBps,
  icon,
  publicAmount,
  publicValue,
  securedAmount,
  securedValue,
  symbol,
  totalAmount,
  totalValue,
}: {
  apyBps?: number | null;
  icon: string;
  publicAmount: string | null | undefined;
  publicValue: string | null | undefined;
  securedAmount: string | null | undefined;
  securedValue: string | null | undefined;
  symbol: string;
  totalAmount: string;
  totalValue: string | null | undefined;
}) {
  const hasPublic = hasDisplayBalance(publicAmount);
  const hasSecured = hasDisplayBalance(securedAmount);
  const hasSplit = hasPublic && hasSecured;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <div
        style={{
          alignItems: "baseline",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span style={sectionTitleStyle}>Your balance</span>
        <span
          style={{
            color: COLOR_PRIMARY,
            fontFamily: FONT,
            fontSize: "18px",
            fontWeight: 600,
            lineHeight: "24px",
          }}
        >
          {totalAmount} {symbol}
          {totalValue ? (
            <span
              style={{
                color: COLOR_SECONDARY,
                fontSize: "13px",
                fontWeight: 400,
                marginLeft: "6px",
              }}
            >
              {totalValue}
            </span>
          ) : null}
        </span>
      </div>
      {hasSplit && (
        <div
          style={{
            borderTop: "1px solid rgba(0, 0, 0, 0.06)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            paddingTop: "10px",
          }}
        >
          {publicAmount && (
            <AssetBalanceRow
              amount={`${publicAmount} ${symbol}`}
              icon={icon}
              label="Unshielded"
              value={publicValue}
            />
          )}
          {securedAmount && (
            <AssetBalanceRow
              amount={`${securedAmount} ${symbol}`}
              apyBps={apyBps}
              icon={icon}
              isShielded
              label="Shielded"
              value={securedValue}
            />
          )}
        </div>
      )}
    </section>
  );
}

function AssetBalanceRow({
  amount,
  apyBps,
  icon,
  isShielded = false,
  label,
  value,
}: {
  amount: string;
  apyBps?: number | null;
  icon: string;
  isShielded?: boolean;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        borderRadius: "14px",
        display: "flex",
        gap: "12px",
        padding: "8px 0",
      }}
    >
      <div
        style={{
          borderRadius: "14px",
          flexShrink: 0,
          height: "46px",
          position: "relative",
          width: "46px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src={icon}
          style={{
            borderRadius: "14px",
            height: "100%",
            objectFit: "cover",
            width: "100%",
          }}
        />
        {isShielded && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              src="/hero-new/Shield_40.svg"
              style={{
                bottom: "-4px",
                height: "22px",
                position: "absolute",
                right: "-4px",
                width: "22px",
              }}
            />
          </>
        )}
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          gap: "3px",
          minWidth: 0,
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: "6px" }}>
          <span
            style={{
              color: COLOR_PRIMARY,
              fontFamily: FONT,
              fontSize: "15px",
              fontWeight: 500,
              lineHeight: "20px",
            }}
          >
            {label}
          </span>
          {typeof apyBps === "number" && apyBps > 0 && (
            <span
              style={{
                color: COLOR_GREEN,
                fontFamily: FONT,
                fontSize: "12px",
                fontWeight: 600,
                lineHeight: "16px",
              }}
            >
              {(apyBps / 100).toFixed(2)}% APY
            </span>
          )}
        </div>
        <span
          style={{
            color: COLOR_SECONDARY,
            fontFamily: FONT,
            fontSize: "13px",
            lineHeight: "16px",
          }}
        >
          {isShielded ? "Private balance" : "Main balance"}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          textAlign: "right",
        }}
      >
        <span style={valueStyle}>{amount}</span>
        {value ? (
          <span
            style={{
              color: COLOR_SECONDARY,
              fontFamily: FONT,
              fontSize: "13px",
              lineHeight: "16px",
            }}
          >
            {value}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function SecurityBadge({
  label,
  tone,
}: {
  label: string;
  tone: "green" | "orange";
}) {
  const color = tone === "green" ? COLOR_GREEN : COLOR_ORANGE;
  const background =
    tone === "green" ? "rgba(52, 199, 89, 0.1)" : "rgba(255, 149, 0, 0.1)";

  return (
    <span
      style={{
        alignItems: "center",
        background,
        borderRadius: "9999px",
        color,
        display: "inline-flex",
        fontFamily: FONT,
        fontSize: "13px",
        fontWeight: 500,
        gap: "6px",
        lineHeight: "18px",
        padding: "7px 10px",
      }}
    >
      <Shield size={14} strokeWidth={2} />
      {label}
    </span>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        borderBottom: "1px solid rgba(0, 0, 0, 0.06)",
        display: "flex",
        flexDirection: "column",
        gap: "3px",
        minWidth: 0,
        padding: "10px 12px 10px 0",
      }}
    >
      <span style={labelStyle}>{label}</span>
      <span
        style={{
          ...valueStyle,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function LinkRow({
  icon,
  label,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
}) {
  return (
    <a
      className="token-detail-link"
      href={href}
      rel="noopener noreferrer"
      style={{
        alignItems: "center",
        background: "transparent",
        borderRadius: "8px",
        color: COLOR_PRIMARY,
        cursor: "pointer",
        display: "flex",
        gap: "8px",
        padding: "10px 4px",
        textDecoration: "none",
        transition: "background 0.15s ease",
      }}
      target="_blank"
    >
      {icon}
      <span
        style={{
          flex: 1,
          fontFamily: FONT,
          fontSize: "13px",
          fontWeight: 400,
        }}
      >
        {label}
      </span>
      <ExternalLink
        size={14}
        style={{ color: COLOR_SECONDARY, flexShrink: 0 }}
      />
    </a>
  );
}

function XIcon() {
  return (
    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"
        fill="rgba(60, 60, 67, 0.6)"
      />
    </svg>
  );
}
