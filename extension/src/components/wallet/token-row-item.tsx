import { useState } from "react";

import type { TokenRow } from "@loyal-labs/wallet-core/types";

const LOYAL_JUP_URL = "https://jup.ag/tokens/LYLikzBQtpa9ZgVrJsqYGQpR3cC1WMJrBHaXGrQmeta";

export function TokenRowItem({
  token,
  isBalanceHidden,
}: {
  token: TokenRow;
  isBalanceHidden: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const isLoyal = token.symbol === "LOYAL";

  const row = (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={isLoyal ? () => globalThis.open(LOYAL_JUP_URL, "_blank") : undefined}
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
    </div>
  );

  return row;
}
