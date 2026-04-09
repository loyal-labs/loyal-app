"use client";

import { Zap } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import type { TokenRow } from "./types";

function formatApyBps(apyBps: number): string {
  return `${(apyBps / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}% APY`;
}

export function TokenRowItem({
  token,
  isBalanceHidden,
}: {
  token: TokenRow;
  isBalanceHidden: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        borderRadius: "16px",
        width: "100%",
        overflow: "hidden",
        background: hovered ? "rgba(0, 0, 0, 0.04)" : "transparent",
        transition: "background-color 0.15s ease",
        cursor: "pointer",
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
              {formatApyBps(token.apyBps)}
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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "2px",
          alignItems: "flex-end",
          justifyContent: "center",
          padding: "10px 0",
          paddingLeft: "12px",
          flexShrink: 0,
          borderRadius: "6px",
          overflow: "hidden",
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
        {token.earnedValueDisplay && token.principalValueDisplay ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "13px",
              fontWeight: 400,
              lineHeight: "16px",
              filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
              transition: "filter 0.15s ease, color 0.15s ease",
              userSelect: isBalanceHidden ? "none" : "auto",
            }}
          >
            <span
              style={{
                color: isBalanceHidden ? "#C8C8CC" : "#2EA043",
                fontWeight: 500,
              }}
            >
              {token.earnedValueDisplay}
            </span>
            <span
              style={{
                color: isBalanceHidden ? "#C8C8CC" : "rgba(60, 60, 67, 0.6)",
              }}
            >
              {token.principalValueDisplay}
            </span>
          </span>
        ) : (
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
        )}
      </div>
    </div>
  );
}
