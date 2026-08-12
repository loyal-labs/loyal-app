import { useState } from "react";

import type { ActivityRow } from "@loyal-labs/wallet-core/types";

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export function ActivityRowItem({
  activity,
  isBalanceHidden,
  onClick,
}: {
  activity: ActivityRow | (ActivityRow & { timestamp: string });
  isBalanceHidden: boolean;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
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
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "9999px",
            overflow: "hidden",
          }}
        >
          <img
            alt={activity.type}
            height={48}
            src={activity.icon}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            width={48}
          />
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
          {activity.type === "received" ? "Received"
            : activity.type === "shielded" ? "Shielded"
            : activity.type === "unshielded" ? "Unshielded"
            : "Sent"}
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
          {activity.type === "shielded" ? "to secure balance"
            : activity.type === "unshielded" ? "to main balance"
            : activity.type === "received" ? `from ${truncateAddress(activity.counterparty)}`
            : `to ${truncateAddress(activity.counterparty)}`}
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
            color: isBalanceHidden
              ? "#BBBBC0"
              : activity.type === "received"
                ? "#34C759"
                : activity.type === "shielded" || activity.type === "unshielded"
                  ? "#000"
                  : "#000",
            textAlign: "right",
            filter: isBalanceHidden ? "url(#rs-pixelate-sm)" : "none",
            transition: "filter 0.15s ease, color 0.15s ease",
            userSelect: isBalanceHidden ? "none" : "auto",
            whiteSpace: "nowrap",
          }}
        >
          {activity.amount}
        </span>
        <span
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "13px",
            fontWeight: 400,
            lineHeight: "16px",
            color: "rgba(60, 60, 67, 0.6)",
            whiteSpace: "nowrap",
          }}
        >
          {activity.timestamp}
        </span>
      </div>
    </div>
  );
}
