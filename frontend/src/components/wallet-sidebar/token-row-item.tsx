"use client";

import {
  ArrowUpRight,
  DollarSign,
  RefreshCw,
  Shield,
  ShieldOff,
  Zap,
} from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import type { TokenRow } from "./types";

const LOYL_MINT = "LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";
const JUP_LOYAL_URL = `https://jup.ag/tokens/${LOYL_MINT}`;

export type TokenRowActions = {
  onSend?: (token: TokenRow) => void;
  onSwap?: (token: TokenRow) => void;
  onShield?: (token: TokenRow) => void;
  onUnshield?: (token: TokenRow) => void;
  onBuy?: (token: TokenRow) => void;
};

export type TokenPairConnection = "none" | "first" | "last";

function getTokenPairKey(token: TokenRow): string {
  return (token.id?.replace(/-secured$/, "") ?? token.symbol).toLowerCase();
}

export function getTokenPairConnection(
  tokens: TokenRow[],
  index: number
): TokenPairConnection {
  const token = tokens[index];
  const previous = tokens[index - 1];
  const next = tokens[index + 1];

  if (!token) return "none";

  const isPair = (candidate: TokenRow | undefined) =>
    candidate !== undefined &&
    getTokenPairKey(candidate) === getTokenPairKey(token) &&
    candidate.isSecured !== token.isSecured;

  if (isPair(previous)) return "last";
  if (isPair(next)) return "first";
  return "none";
}

function ActionIcon({
  icon: Icon,
  title,
  onClick,
}: {
  icon: typeof ArrowUpRight;
  title: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  const [iconHovered, setIconHovered] = useState(false);
  return (
    <button
      aria-label={title}
      onClick={onClick}
      onMouseEnter={() => setIconHovered(true)}
      onMouseLeave={() => setIconHovered(false)}
      style={{
        width: "32px",
        height: "32px",
        borderRadius: "9999px",
        border: "none",
        background: iconHovered ? "rgba(0, 0, 0, 0.08)" : "rgba(0, 0, 0, 0.04)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "background 0.15s ease",
        flexShrink: 0,
        padding: 0,
      }}
      title={title}
      type="button"
    >
      <Icon
        size={16}
        strokeWidth={2}
        style={{ color: "rgba(60, 60, 67, 0.6)" }}
      />
    </button>
  );
}

export function TokenRowItem({
  token,
  isBalanceHidden,
  actions,
  onDetail,
  pairConnection = "none",
}: {
  token: TokenRow;
  isBalanceHidden: boolean;
  actions?: TokenRowActions;
  onDetail?: (token: TokenRow) => void;
  pairConnection?: TokenPairConnection;
}) {
  const [hovered, setHovered] = useState(false);

  const isLoyal = token.id === LOYL_MINT || token.symbol === "LOYAL";
  const canOpenDetail = !!onDetail || isLoyal;

  const handleRowClick = () => {
    if (onDetail) {
      onDetail(token);
      return;
    }

    if (isLoyal) {
      window.open(JUP_LOYAL_URL, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div
      onClick={handleRowClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        alignItems: "center",
        background: hovered ? "rgba(0, 0, 0, 0.04)" : "transparent",
        borderRadius: "16px",
        cursor: canOpenDetail ? "pointer" : "default",
        display: "flex",
        marginBottom: pairConnection === "last" ? "8px" : 0,
        overflow: "visible",
        padding: "0 12px",
        position: "relative",
        transition: "background-color 0.15s ease",
        width: "100%",
      }}
    >
      {pairConnection !== "none" && (
        <span
          aria-hidden="true"
          style={{
            background: hovered
              ? "rgba(0, 0, 0, 0.14)"
              : "rgba(0, 0, 0, 0.09)",
            bottom: pairConnection === "first" ? "-4px" : "30px",
            left: "36px",
            position: "absolute",
            top: pairConnection === "first" ? "30px" : "-4px",
            transition: "background 0.15s ease",
            width: "1px",
          }}
        />
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          paddingRight: "12px",
          paddingTop: "6px",
          paddingBottom: "6px",
          flexShrink: 0,
        }}
      >
        <div style={{ position: "relative", width: "48px", height: "48px" }}>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "9999px",
              overflow: "hidden",
            }}
          >
            <Image
              alt={token.symbol}
              height={48}
              src={token.icon}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              width={48}
            />
          </div>
          {token.isSecured && (
            <Image
              alt="Secured"
              height={24}
              src="/hero-new/Shield.png"
              style={{ position: "absolute", bottom: -2, right: -2 }}
              width={24}
            />
          )}
        </div>
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: "2px",
          padding: "10px 0",
          minWidth: 0,
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: "6px",
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "16px",
              fontWeight: 500,
              lineHeight: "20px",
              color: "#000",
              letterSpacing: "-0.176px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {token.name ?? token.symbol}
          </span>
          {typeof token.apyBps === "number" && token.apyBps > 0 && (
            <span
              style={{
                alignItems: "center",
                background: "rgba(52, 199, 89, 0.12)",
                borderRadius: "9999px",
                color: "#2EA043",
                display: "inline-flex",
                flexShrink: 0,
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "11px",
                fontWeight: 600,
                gap: "2px",
                letterSpacing: "-0.1px",
                lineHeight: "14px",
                padding: "2px 6px",
              }}
            >
              <Zap
                fill="currentColor"
                size={10}
                strokeWidth={2.5}
                style={{ display: "block" }}
              />
              {(token.apyBps / 100).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
              % APY
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "13px",
              fontWeight: 400,
              lineHeight: "16px",
              color: "rgba(60, 60, 67, 0.6)",
            }}
          >
            {token.price}
          </span>
          {typeof token.priceChange24h === "number" && (
            <span
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "11px",
                fontWeight: 500,
                lineHeight: "14px",
                color:
                  token.priceChange24h > 0
                    ? "#34C759"
                    : token.priceChange24h < 0
                      ? "#FF3B30"
                      : "rgba(60, 60, 67, 0.6)",
                border: `1px solid ${
                  token.priceChange24h > 0
                    ? "rgba(52, 199, 89, 0.2)"
                    : token.priceChange24h < 0
                      ? "rgba(255, 59, 48, 0.2)"
                      : "rgba(60, 60, 67, 0.12)"
                }`,
                borderRadius: "9999px",
                padding: "1px 6px",
                flexShrink: 0,
              }}
            >
              {token.priceChange24h >= 0 ? "+" : ""}
              {token.priceChange24h.toFixed(2)}%
            </span>
          )}
        </div>
      </div>
      {/* Right side: balance (default) or action icons (on hover) */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingLeft: "12px",
          flexShrink: 0,
          minWidth: "100px",
        }}
      >
        {/* Balance — fades out on hover */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: "10px 0",
            borderRadius: "6px",
            overflow: "hidden",
            opacity: hovered && actions ? 0 : 1,
            transition: "opacity 0.15s ease",
            pointerEvents: hovered && actions ? "none" : "auto",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "16px",
              fontWeight: 400,
              lineHeight: "20px",
              color: isBalanceHidden ? "#BBBBC0" : "#000",
              textAlign: "right",
              filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
              transition: "filter 0.15s ease, color 0.15s ease",
              userSelect: isBalanceHidden ? "none" : "auto",
            }}
          >
            {token.value}
          </span>
          <span
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "13px",
              fontWeight: 400,
              lineHeight: "16px",
              color: isBalanceHidden ? "#C8C8CC" : "rgba(60, 60, 67, 0.6)",
              filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
              transition: "filter 0.15s ease, color 0.15s ease",
              userSelect: isBalanceHidden ? "none" : "auto",
            }}
          >
            {token.amount} {token.symbol}
          </span>
        </div>

        {/* Action icons — appear on hover */}
        {actions && (
          <div
            style={{
              position: "absolute",
              right: 0,
              display: "flex",
              gap: "4px",
              alignItems: "center",
              opacity: hovered ? 1 : 0,
              transition: "opacity 0.15s ease",
              pointerEvents: hovered ? "auto" : "none",
            }}
          >
            {actions.onSend && (
              <ActionIcon
                icon={ArrowUpRight}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.onSend!(token);
                }}
                title="Send"
              />
            )}
            {actions.onSwap && (
              <ActionIcon
                icon={RefreshCw}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.onSwap!(token);
                }}
                title="Swap"
              />
            )}
            {actions.onShield && (
              <ActionIcon
                icon={Shield}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.onShield!(token);
                }}
                title="Shield"
              />
            )}
            {actions.onUnshield && (
              <ActionIcon
                icon={ShieldOff}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.onUnshield!(token);
                }}
                title="Unshield"
              />
            )}
            {actions.onBuy && (
              <ActionIcon
                icon={DollarSign}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.onBuy!(token);
                }}
                title="Buy"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
