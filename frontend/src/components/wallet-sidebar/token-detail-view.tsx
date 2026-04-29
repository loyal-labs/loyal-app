"use client";

import {
  ArrowLeft,
  Check,
  ExternalLink,
  Globe,
  Shield,
  ShieldOff,
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

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: "16px",
  padding: "16px",
};

const labelStyle: React.CSSProperties = {
  color: COLOR_SECONDARY,
  fontFamily: FONT,
  fontSize: "13px",
  fontWeight: 500,
  lineHeight: "16px",
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

  const prices = points.map((point) => point.priceUsd);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const width = 100;
  const height = 44;
  const line = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - ((point.priceUsd - min) / range) * (height - 4) - 2;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return {
    area: `${line} L ${width} ${height} L 0 ${height} Z`,
    line,
  };
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
  const paths = useMemo(() => buildChartPath(points), [points]);
  const hoveredPoint =
    hoveredIndex !== null ? points[hoveredIndex] ?? null : null;
  const hoveredY = useMemo(() => {
    if (!hoveredPoint) return null;

    const prices = points.map((point) => point.priceUsd);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;

    return 44 - ((hoveredPoint.priceUsd - min) / range) * 40 - 2;
  }, [hoveredPoint, points]);

  if (!paths) {
    return null;
  }

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = chartRef.current?.getBoundingClientRect();

    if (!bounds || points.length < 2) return;

    const x = Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width);
    const index = Math.round((x / bounds.width) * (points.length - 1));
    setHoveredIndex(Math.min(Math.max(index, 0), points.length - 1));
  };
  const markerX =
    hoveredIndex === null || points.length < 2
      ? null
      : (hoveredIndex / (points.length - 1)) * 100;

  return (
    <div style={{ ...cardStyle, padding: "12px 0 0" }}>
      <div
        aria-hidden={!hoveredPoint}
        style={{
          color: COLOR_PRIMARY,
          fontFamily: FONT,
          fontSize: "16px",
          fontWeight: 600,
          lineHeight: "20px",
          opacity: hoveredPoint ? 1 : 0,
          padding: "0 16px 8px",
          textAlign: "center",
          transition: "opacity 0.12s ease",
        }}
      >
        {hoveredPoint ? formatPrice(hoveredPoint.priceUsd) : "$0.00"}
      </div>
      <svg
        aria-label="24 hour price chart"
        onPointerLeave={() => setHoveredIndex(null)}
        onPointerMove={handlePointerMove}
        preserveAspectRatio="none"
        ref={chartRef}
        role="img"
        style={{
          cursor: "crosshair",
          display: "block",
          height: "180px",
          touchAction: "none",
          width: "100%",
        }}
        viewBox="0 0 100 44"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
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
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
        />
        {markerX !== null && hoveredPoint && hoveredY !== null && (
          <>
            <line
              stroke="rgba(0, 0, 0, 0.16)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              x1={markerX}
              x2={markerX}
              y1="0"
              y2="44"
            />
            <circle
              cx={markerX}
              cy={hoveredY}
              fill={color}
              r="1.8"
              stroke="#fff"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
      <div
        style={{
          color: COLOR_SECONDARY,
          fontFamily: FONT,
          fontSize: "12px",
          lineHeight: "16px",
          minHeight: "16px",
          padding: "0 16px 12px",
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
    : detail?.token.name ?? token.symbol;
  const displaySymbol = isNativeSol
    ? "SOL"
    : detail?.token.symbol ?? token.symbol;
  const displayIcon = isNativeSol
    ? token.icon
    : detail?.token.logoUrl ?? token.icon;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style jsx>{`
        @keyframes token-detail-spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          padding: "8px",
        }}
      >
        <span style={{ height: "36px", width: "36px" }} />
        <span
          style={{
            color: "#000",
            fontFamily: FONT,
            fontSize: "18px",
            fontWeight: 600,
            lineHeight: "28px",
          }}
        >
          {token.symbol}
        </span>
        <button
          className="token-detail-back"
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
            transition: "all 0.2s ease",
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
            alignItems: "center",
            display: "flex",
            flex: 1,
            justifyContent: "center",
          }}
        >
          <div
            style={{
              animation: "token-detail-spin 0.8s linear infinite",
              border: "2px solid rgba(0, 0, 0, 0.1)",
              borderRadius: "9999px",
              borderTopColor: "#3C3C43",
              height: "24px",
              width: "24px",
            }}
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
          <p
            style={{
              color: COLOR_SECONDARY,
              fontFamily: FONT,
              fontSize: "14px",
              margin: 0,
              textAlign: "center",
            }}
          >
            {error}
          </p>
          <button
            onClick={() => void loadDetail()}
            style={{
              background: "rgba(0, 0, 0, 0.04)",
              border: "none",
              borderRadius: "9999px",
              color: COLOR_PRIMARY,
              cursor: "pointer",
              fontFamily: FONT,
              fontSize: "14px",
              fontWeight: 500,
              padding: "8px 20px",
            }}
            type="button"
          >
            Retry
          </button>
        </div>
      )}

      {detail && !loading && (
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            gap: "12px",
            minHeight: 0,
            overflowX: "hidden",
            overflowY: "auto",
            padding: "0 12px 20px",
          }}
        >
          <div
            style={{
              alignItems: "center",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              padding: "12px 0 4px",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={displaySymbol}
              src={displayIcon}
              style={{
                borderRadius: "9999px",
                height: "48px",
                objectFit: "cover",
                width: "48px",
              }}
            />
            <span
              style={{
                color: COLOR_SECONDARY,
                fontFamily: FONT,
                fontSize: "14px",
                fontWeight: 500,
                lineHeight: "20px",
                marginTop: "4px",
              }}
            >
              {displayName}
            </span>
            <span
              style={{
                color: COLOR_PRIMARY,
                fontFamily: FONT,
                fontSize: "28px",
                fontWeight: 600,
                lineHeight: "32px",
              }}
            >
              {formatPrice(detail.market.priceUsd)}
            </span>
            {priceChange !== null && (
              <span
                style={{
                  color: changeColor,
                  fontFamily: FONT,
                  fontSize: "13px",
                  fontWeight: 500,
                  lineHeight: "16px",
                }}
              >
                {formatPercent(priceChange)} (24h)
              </span>
            )}
          </div>

          <TokenChart color={chartColor} points={detail.chart} />

          {hasAnyBalance && (
            <div
              style={{
                ...cardStyle,
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <span style={labelStyle}>Your balance</span>
              <BalanceRow
                amount={`${totalAmount} ${token.symbol}`}
                label="Total"
                value={totalValue}
              />
              {hasDisplayBalance(publicAmount) && publicAmount && (
                <BalanceRow
                  amount={`${publicAmount} ${token.symbol}`}
                  label="Unshielded"
                  value={publicValue}
                />
              )}
              {hasDisplayBalance(securedAmount) && securedAmount && (
                <BalanceRow
                  amount={`${securedAmount} ${token.symbol}`}
                  label="Shielded"
                  value={securedValue}
                />
              )}
              {typeof token.apyBps === "number" && token.apyBps > 0 && (
                <span
                  style={{
                    alignItems: "center",
                    color: COLOR_GREEN,
                    display: "inline-flex",
                    fontFamily: FONT,
                    fontSize: "12px",
                    fontWeight: 500,
                    gap: "4px",
                  }}
                >
                  <Shield size={12} />
                  Earning {(token.apyBps / 100).toFixed(2)}% APY
                </span>
              )}
            </div>
          )}

          <div style={cardStyle}>
            <span
              style={{ ...labelStyle, display: "block", marginBottom: "12px" }}
            >
              Market data
            </span>
            <div
              style={{
                display: "grid",
                gap: "12px",
                gridTemplateColumns: "1fr 1fr",
              }}
            >
              <StatItem
                label="Market Cap"
                value={formatUsd(detail.market.marketCapUsd)}
              />
              <StatItem label="FDV" value={formatUsd(detail.market.fdvUsd)} />
              <StatItem
                label="Liquidity"
                value={formatUsd(detail.market.liquidityUsd)}
              />
              <StatItem
                label="24h Volume"
                value={formatUsd(detail.market.volume24hUsd)}
              />
            </div>
          </div>

          <div
            style={{
              ...cardStyle,
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <span style={labelStyle}>Token info</span>
            <div style={{ alignItems: "center", display: "flex", gap: "6px" }}>
              <div
                style={{
                  alignItems: "center",
                  background: detail.info.gtVerified
                    ? "rgba(52, 199, 89, 0.12)"
                    : "rgba(0, 0, 0, 0.04)",
                  borderRadius: "9999px",
                  display: "flex",
                  height: "20px",
                  justifyContent: "center",
                  width: "20px",
                }}
              >
                {detail.info.gtVerified ? <Check size={12} /> : "?"}
              </div>
              <span
                style={{
                  ...valueStyle,
                  color: detail.info.gtVerified ? COLOR_GREEN : COLOR_SECONDARY,
                  fontSize: "13px",
                }}
              >
                {detail.info.gtVerified ? "Verified" : "Unverified"}
              </span>
            </div>

            {detail.info.gtScore !== null && (
              <div
                style={{ display: "flex", flexDirection: "column", gap: "6px" }}
              >
                <div
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <span style={{ ...labelStyle, fontSize: "12px" }}>
                    Trust Score
                  </span>
                  <span style={{ ...valueStyle, fontSize: "12px" }}>
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

            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <AuditBadge
                label="Mint Authority"
                safe={detail.info.mintAuthority === "no"}
                value={
                  detail.info.mintAuthority === "no" ? "disabled" : "enabled"
                }
              />
              <AuditBadge
                label="Freeze Authority"
                safe={detail.info.freezeAuthority === "no"}
                value={
                  detail.info.freezeAuthority === "no" ? "disabled" : "enabled"
                }
              />
            </div>
          </div>

          {(detail.market.holderCount !== null ||
            detail.info.holderDistribution) && (
            <div
              style={{
                ...cardStyle,
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div
                style={{
                  alignItems: "baseline",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span style={labelStyle}>Holders</span>
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
                ...cardStyle,
                display: "flex",
                flexDirection: "column",
                gap: 0,
              }}
            >
              <span style={{ ...labelStyle, marginBottom: "8px" }}>Links</span>
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

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <span style={labelStyle}>{label}</span>
      <span style={valueStyle}>{value}</span>
    </div>
  );
}

function BalanceRow({
  label,
  amount,
  value,
}: {
  label: string;
  amount: string;
  value: string | null | undefined;
}) {
  return (
    <div
      style={{
        alignItems: "baseline",
        display: "flex",
        justifyContent: "space-between",
        gap: "12px",
      }}
    >
      <span style={labelStyle}>{label}</span>
      <span
        style={{
          ...valueStyle,
          textAlign: "right",
        }}
      >
        {amount}
        {value ? (
          <span
            style={{
              color: COLOR_SECONDARY,
              fontWeight: 400,
              marginLeft: "6px",
            }}
          >
            {value}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function AuditBadge({
  label,
  value,
  safe,
}: {
  label: string;
  value: string;
  safe: boolean;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        background: safe
          ? "rgba(52, 199, 89, 0.08)"
          : "rgba(255, 149, 0, 0.08)",
        borderRadius: "8px",
        display: "flex",
        gap: "4px",
        padding: "4px 8px",
      }}
    >
      {safe ? (
        <ShieldOff size={12} style={{ color: COLOR_GREEN }} />
      ) : (
        <Shield size={12} style={{ color: COLOR_ORANGE }} />
      )}
      <span
        style={{
          color: safe ? COLOR_GREEN : COLOR_ORANGE,
          fontFamily: FONT,
          fontSize: "11px",
          fontWeight: 500,
        }}
      >
        {label}: {value}
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
  const [hovered, setHovered] = useState(false);

  return (
    <a
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      rel="noopener noreferrer"
      style={{
        alignItems: "center",
        background: hovered ? "rgba(0, 0, 0, 0.04)" : "transparent",
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
