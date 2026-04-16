import { useCallback, useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ExternalLink,
  Globe,
  Shield,
  ShieldOff,
} from "lucide-react";

import type { TokenRow } from "@loyal-labs/wallet-core/types";
import { SubViewHeader } from "./shared";
import { fetchTokenDetail, type TokenDetailData } from "~/src/lib/coingecko";

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatUsd(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toPrecision(4)}`;
}

function formatPrice(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toPrecision(4)}`;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatNumber(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("en-US");
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const FONT = "var(--font-geist-sans), sans-serif";
const COLOR_PRIMARY = "#000";
const COLOR_SECONDARY = "rgba(60, 60, 67, 0.6)";
const COLOR_GREEN = "#34C759";
const COLOR_RED = "#FF3B30";
const COLOR_ORANGE = "#FF9500";

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: "16px",
  padding: "16px",
};

const labelStyle: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: "13px",
  fontWeight: 500,
  lineHeight: "16px",
  color: COLOR_SECONDARY,
};

const valueStyle: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: "14px",
  fontWeight: 500,
  lineHeight: "20px",
  color: COLOR_PRIMARY,
};

// ---------------------------------------------------------------------------
// Custom chart tooltip
// ---------------------------------------------------------------------------

function ChartTooltipContent({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as { timestamp: number; price: number };
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: "8px",
        padding: "6px 10px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        fontFamily: FONT,
        fontSize: "12px",
        lineHeight: "16px",
      }}
    >
      <div style={{ fontWeight: 500, color: COLOR_PRIMARY }}>
        {formatPrice(point.price)}
      </div>
      <div style={{ color: COLOR_SECONDARY }}>{formatTime(point.timestamp)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Token Detail View
// ---------------------------------------------------------------------------

export function TokenDetailView({
  token,
  onBack,
  onClose,
  onSend,
  onReceive,
  onSwap,
  onShield,
}: {
  token: TokenRow;
  onBack: () => void;
  onClose: () => void;
  onSend?: () => void;
  onReceive?: () => void;
  onSwap?: () => void;
  onShield?: () => void;
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load token data");
    } finally {
      setLoading(false);
    }
  }, [mint]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  // Derive 24h change from chart data
  const priceChange =
    detail && detail.chart.length >= 2
      ? ((detail.chart[detail.chart.length - 1].price - detail.chart[0].price) /
          detail.chart[0].price) *
        100
      : null;

  const isPositive = priceChange !== null && priceChange >= 0;
  const changeColor = priceChange === null ? COLOR_SECONDARY : isPositive ? COLOR_GREEN : COLOR_RED;
  const chartColor = isPositive ? COLOR_GREEN : COLOR_RED;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <SubViewHeader title={token.symbol} onBack={onBack} onClose={onClose} />

      {/* Loading state */}
      {loading && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: "24px",
              height: "24px",
              border: "2px solid rgba(0, 0, 0, 0.1)",
              borderTopColor: "#3C3C43",
              borderRadius: "9999px",
              animation: "sidebar-spin 0.8s linear infinite",
            }}
          />
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            padding: "0 20px",
          }}
        >
          <p
            style={{
              fontFamily: FONT,
              fontSize: "14px",
              color: COLOR_SECONDARY,
              textAlign: "center",
              margin: 0,
            }}
          >
            {error}
          </p>
          <button
            type="button"
            onClick={() => void loadDetail()}
            style={{
              fontFamily: FONT,
              fontSize: "14px",
              fontWeight: 500,
              color: COLOR_PRIMARY,
              background: "rgba(0, 0, 0, 0.04)",
              border: "none",
              borderRadius: "9999px",
              padding: "8px 20px",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Content */}
      {detail && !loading && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            padding: "0 12px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {/* Price hero */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "4px",
              padding: "12px 0 4px",
            }}
          >
            <img
              src={detail.token.imageUrl || token.icon}
              alt={detail.token.symbol}
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "9999px",
                objectFit: "cover",
              }}
            />
            <span
              style={{
                fontFamily: FONT,
                fontSize: "14px",
                fontWeight: 500,
                lineHeight: "20px",
                color: COLOR_SECONDARY,
                marginTop: "4px",
              }}
            >
              {detail.token.name}
            </span>
            <span
              style={{
                fontFamily: FONT,
                fontSize: "28px",
                fontWeight: 600,
                lineHeight: "32px",
                color: COLOR_PRIMARY,
              }}
            >
              {formatPrice(detail.token.priceUsd)}
            </span>
            {priceChange !== null && (
              <span
                style={{
                  fontFamily: FONT,
                  fontSize: "13px",
                  fontWeight: 500,
                  lineHeight: "16px",
                  color: changeColor,
                }}
              >
                {formatPercent(priceChange)} (24h)
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "0 4px",
            }}
          >
            {(
              [
                onSend && { label: "Send", Icon: ArrowUpRight, action: onSend },
                onReceive && { label: "Receive", Icon: ArrowDownLeft, action: onReceive },
                onSwap && { label: "Swap", Icon: ArrowLeftRight, action: onSwap },
                onShield && { label: token.isSecured ? "Unshield" : "Shield", Icon: Shield, action: onShield },
              ].filter(Boolean) as { label: string; Icon: typeof ArrowUpRight; action: () => void }[]
            ).map(({ label, Icon, action }) => (
              <button
                key={label}
                type="button"
                onClick={action}
                onMouseEnter={(e) => {
                  const circle = e.currentTarget.querySelector("[data-action-circle]") as HTMLElement;
                  if (circle) circle.style.background = "rgba(249, 54, 60, 0.22)";
                }}
                onMouseLeave={(e) => {
                  const circle = e.currentTarget.querySelector("[data-action-circle]") as HTMLElement;
                  if (circle) circle.style.background = "rgba(249, 54, 60, 0.14)";
                }}
                onMouseDown={(e) => {
                  const circle = e.currentTarget.querySelector("[data-action-circle]") as HTMLElement;
                  if (circle) circle.style.transform = "scale(0.93)";
                }}
                onMouseUp={(e) => {
                  const circle = e.currentTarget.querySelector("[data-action-circle]") as HTMLElement;
                  if (circle) circle.style.transform = "scale(1)";
                }}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  minWidth: 0,
                  overflow: "hidden",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <div
                  data-action-circle
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "9999px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(249, 54, 60, 0.14)",
                    transition: "background 0.15s ease, transform 0.15s ease",
                  }}
                >
                  <Icon size={24} strokeWidth={1.5} style={{ color: "#000" }} />
                </div>
                <span
                  style={{
                    fontFamily: FONT,
                    fontSize: "13px",
                    lineHeight: "16px",
                    color: COLOR_SECONDARY,
                  }}
                >
                  {label}
                </span>
              </button>
            ))}
          </div>

          {/* Chart */}
          {detail.chart.length >= 2 && (
            <div style={{ ...cardStyle, padding: "12px 0 0" }}>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart
                  data={detail.chart}
                  margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColor} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(0,0,0,0.04)"
                    vertical={false}
                  />
                  <XAxis dataKey="timestamp" hide />
                  <YAxis hide domain={["auto", "auto"]} />
                  <Tooltip
                    content={<ChartTooltipContent />}
                    cursor={{ stroke: "rgba(0,0,0,0.1)", strokeWidth: 1 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="price"
                    stroke={chartColor}
                    strokeWidth={2}
                    fill="url(#chartGradient)"
                    animationDuration={800}
                    dot={false}
                    activeDot={{
                      r: 4,
                      fill: chartColor,
                      stroke: "#fff",
                      strokeWidth: 2,
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Position card */}
          {parseFloat(token.amount) > 0 && (
            <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "8px" }}>
              <span style={labelStyle}>Your balance</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                <span style={{ ...valueStyle, fontSize: "18px", fontWeight: 600 }}>
                  {token.amount} {token.symbol}
                </span>
                {token.isSecured && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "3px",
                      fontFamily: FONT,
                      fontSize: "11px",
                      fontWeight: 500,
                      color: COLOR_GREEN,
                      background: "rgba(52, 199, 89, 0.1)",
                      borderRadius: "6px",
                      padding: "2px 6px",
                    }}
                  >
                    <Shield size={10} />
                    Shielded
                  </span>
                )}
              </div>
              <span style={{ ...labelStyle, fontSize: "14px" }}>{token.value}</span>
              {typeof token.apyBps === "number" && token.apyBps > 0 && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "3px",
                    fontFamily: FONT,
                    fontSize: "12px",
                    fontWeight: 500,
                    color: COLOR_GREEN,
                  }}
                >
                  Earning {(token.apyBps / 100).toFixed(2)}% APY
                </span>
              )}
            </div>
          )}

          {/* Market stats */}
          <div style={cardStyle}>
            <span style={{ ...labelStyle, display: "block", marginBottom: "12px" }}>
              Market data
            </span>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px",
              }}
            >
              <StatItem label="Market Cap" value={formatUsd(detail.token.marketCapUsd)} />
              <StatItem label="FDV" value={formatUsd(detail.token.fdvUsd)} />
              <StatItem label="Liquidity" value={formatUsd(detail.token.totalReserveUsd)} />
              <StatItem label="24h Volume" value={formatUsd(detail.token.volumeUsd24h)} />
            </div>
          </div>

          {/* Token info */}
          <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "12px" }}>
            <span style={labelStyle}>Token info</span>

            {/* Verified status */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div
                style={{
                  width: "20px",
                  height: "20px",
                  borderRadius: "9999px",
                  background: detail.info.gtVerified
                    ? "rgba(52, 199, 89, 0.12)"
                    : "rgba(0, 0, 0, 0.04)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span style={{ fontSize: "11px" }}>
                  {detail.info.gtVerified ? "✓" : "?"}
                </span>
              </div>
              <span
                style={{
                  ...valueStyle,
                  fontSize: "13px",
                  color: detail.info.gtVerified ? COLOR_GREEN : COLOR_SECONDARY,
                }}
              >
                {detail.info.gtVerified ? "Verified" : "Unverified"}
              </span>
            </div>

            {/* GT Score */}
            {detail.info.gtScore !== null && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ ...labelStyle, fontSize: "12px" }}>Trust Score</span>
                  <span style={{ ...valueStyle, fontSize: "12px" }}>
                    {detail.info.gtScore.toFixed(1)} / 100
                  </span>
                </div>
                <div
                  style={{
                    height: "4px",
                    borderRadius: "2px",
                    background: "rgba(0, 0, 0, 0.06)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      borderRadius: "2px",
                      width: `${Math.min(detail.info.gtScore, 100)}%`,
                      background:
                        detail.info.gtScore >= 70
                          ? COLOR_GREEN
                          : detail.info.gtScore >= 40
                            ? COLOR_ORANGE
                            : COLOR_RED,
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Audit flags */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <AuditBadge
                label="Mint Authority"
                value={detail.info.mintAuthority === "no" ? "disabled" : "enabled"}
                safe={detail.info.mintAuthority === "no"}
              />
              <AuditBadge
                label="Freeze Authority"
                value={detail.info.freezeAuthority === "no" ? "disabled" : "enabled"}
                safe={detail.info.freezeAuthority === "no"}
              />
            </div>
          </div>

          {/* Holders */}
          {(detail.info.holderCount !== null || detail.info.holderDistribution) && (
            <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={labelStyle}>Holders</span>
                {detail.info.holderCount !== null && (
                  <span style={valueStyle}>{formatNumber(detail.info.holderCount)}</span>
                )}
              </div>
              {detail.info.holderDistribution && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div
                      style={{
                        flex: 1,
                        height: "8px",
                        borderRadius: "4px",
                        background: "rgba(0, 0, 0, 0.06)",
                        overflow: "hidden",
                        display: "flex",
                      }}
                    >
                      <div
                        style={{
                          width: `${parseFloat(detail.info.holderDistribution.top10)}%`,
                          background: COLOR_ORANGE,
                          borderRadius: "4px 0 0 4px",
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ ...labelStyle, fontSize: "12px" }}>
                      Top 10: {parseFloat(detail.info.holderDistribution.top10).toFixed(1)}%
                    </span>
                    <span style={{ ...labelStyle, fontSize: "12px" }}>
                      Rest: {parseFloat(detail.info.holderDistribution.rest).toFixed(1)}%
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Links */}
          {(detail.info.websites.length > 0 || detail.info.twitterHandle) && (
            <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: "0" }}>
              <span style={{ ...labelStyle, marginBottom: "8px" }}>Links</span>
              {detail.info.websites[0] && (
                <LinkRow
                  icon={<Globe size={16} style={{ color: COLOR_SECONDARY }} />}
                  label={detail.info.websites[0].replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  href={detail.info.websites[0]}
                />
              )}
              {detail.info.twitterHandle && (
                <LinkRow
                  icon={<XIcon />}
                  label={`@${detail.info.twitterHandle}`}
                  href={`https://x.com/${detail.info.twitterHandle}`}
                />
              )}
              {detail.info.discordUrl && (
                <LinkRow
                  icon={<Globe size={16} style={{ color: COLOR_SECONDARY }} />}
                  label="Discord"
                  href={detail.info.discordUrl}
                />
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <span style={labelStyle}>{label}</span>
      <span style={valueStyle}>{value}</span>
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
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "4px 8px",
        borderRadius: "8px",
        background: safe ? "rgba(52, 199, 89, 0.08)" : "rgba(255, 149, 0, 0.08)",
      }}
    >
      {safe ? (
        <ShieldOff size={12} style={{ color: COLOR_GREEN }} />
      ) : (
        <Shield size={12} style={{ color: COLOR_ORANGE }} />
      )}
      <span
        style={{
          fontFamily: FONT,
          fontSize: "11px",
          fontWeight: 500,
          color: safe ? COLOR_GREEN : COLOR_ORANGE,
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
      target="_blank"
      rel="noopener noreferrer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "10px 4px",
        borderRadius: "8px",
        textDecoration: "none",
        background: hovered ? "rgba(0, 0, 0, 0.04)" : "transparent",
        transition: "background 0.15s ease",
        cursor: "pointer",
      }}
    >
      {icon}
      <span
        style={{
          flex: 1,
          fontFamily: FONT,
          fontSize: "13px",
          fontWeight: 400,
          color: COLOR_PRIMARY,
        }}
      >
        {label}
      </span>
      <ExternalLink size={14} style={{ color: COLOR_SECONDARY, flexShrink: 0 }} />
    </a>
  );
}

function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"
        fill="rgba(60, 60, 67, 0.6)"
      />
    </svg>
  );
}
