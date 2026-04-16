import { ArrowUpRight, DollarSign, RefreshCw, Shield, ShieldOff, Zap } from "lucide-react";
import { useState } from "react";

import type { TokenRow } from "@loyal-labs/wallet-core/types";

export type TokenRowActions = {
  onSend?: (token: TokenRow) => void;
  onSwap?: (token: TokenRow) => void;
  onShield?: (token: TokenRow) => void;
  onUnshield?: (token: TokenRow) => void;
  onBuy?: (token: TokenRow) => void;
};

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
      <Icon size={16} strokeWidth={2} style={{ color: "rgba(60, 60, 67, 0.6)" }} />
    </button>
  );
}

export function TokenRowItem({
  token,
  isBalanceHidden,
  actions,
  onDetail,
}: {
  token: TokenRow;
  isBalanceHidden: boolean;
  actions?: TokenRowActions;
  onDetail?: (token: TokenRow) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onDetail?.(token)}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        borderRadius: "16px",
        width: "100%",
        overflow: "hidden",
        background: hovered ? "rgba(0, 0, 0, 0.04)" : "transparent",
        transition: "background-color 0.15s ease",
        cursor: onDetail ? "pointer" : "default",
      }}
    >
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
            <img
              alt={token.symbol}
              height={48}
              src={token.icon}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              width={48}
            />
          </div>
          {token.isSecured && (
            <img
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
            display: "flex",
            alignItems: "center",
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
            }}
          >
            {token.symbol}
          </span>
          {typeof token.apyBps === "number" && token.apyBps > 0 && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "2px",
                padding: "2px 6px",
                borderRadius: "9999px",
                background: "rgba(52, 199, 89, 0.12)",
                color: "#2EA043",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: "11px",
                fontWeight: 600,
                lineHeight: "14px",
                letterSpacing: "-0.1px",
                flexShrink: 0,
              }}
            >
              <Zap
                size={10}
                strokeWidth={2.5}
                fill="currentColor"
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
            {token.amount}
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
            {token.value}
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
                onClick={(e) => { e.stopPropagation(); actions.onSend!(token); }}
                title="Send"
              />
            )}
            {actions.onSwap && (
              <ActionIcon
                icon={RefreshCw}
                onClick={(e) => { e.stopPropagation(); actions.onSwap!(token); }}
                title="Swap"
              />
            )}
            {actions.onShield && (
              <ActionIcon
                icon={Shield}
                onClick={(e) => { e.stopPropagation(); actions.onShield!(token); }}
                title="Shield"
              />
            )}
            {actions.onUnshield && (
              <ActionIcon
                icon={ShieldOff}
                onClick={(e) => { e.stopPropagation(); actions.onUnshield!(token); }}
                title="Unshield"
              />
            )}
            {actions.onBuy && (
              <ActionIcon
                icon={DollarSign}
                onClick={(e) => { e.stopPropagation(); actions.onBuy!(token); }}
                title="Buy"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
