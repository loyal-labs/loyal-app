"use client";

import type { ActivityRow, TransactionDetail } from "@/components/wallet-sidebar/types";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

export type EarnTransactionItem = {
  id: string;
  kind: "deposit" | "withdraw";
  dateGroup: string;
  timestamp: string;
  amount: string;
  rawAmount: string;
  source: { label: string; icon: string | null };
  destination: { label: string; icon: string | null };
};

const KAMINO_ICON = "/wallet-workspace/earn-kamino.png";
const MAIN_ICON = "/agents/Agent-01.svg";
const STASH_ICON = "/agents/Stashx.svg";

const EARN_TRANSACTIONS: EarnTransactionItem[] = [
  {
    id: "earn-tx-1",
    kind: "withdraw",
    dateGroup: "May 29",
    timestamp: "18:06",
    amount: "+1,010.22 USDC",
    rawAmount: "1,010.22",
    source: { label: "Kamino", icon: null },
    destination: { label: "Main", icon: MAIN_ICON },
  },
  {
    id: "earn-tx-2",
    kind: "deposit",
    dateGroup: "May 29",
    timestamp: "18:06",
    amount: "−1,000.00 USDC",
    rawAmount: "1,000.00",
    source: { label: "Main", icon: MAIN_ICON },
    destination: { label: "Kamino", icon: null },
  },
  {
    id: "earn-tx-3",
    kind: "withdraw",
    dateGroup: "April 29",
    timestamp: "18:06",
    amount: "+1,010.00 USDC",
    rawAmount: "1,010.00",
    source: { label: "Kamino", icon: null },
    destination: { label: "Stash", icon: STASH_ICON },
  },
  {
    id: "earn-tx-4",
    kind: "deposit",
    dateGroup: "April 29",
    timestamp: "18:06",
    amount: "−1,000.00 USDC",
    rawAmount: "1,000.00",
    source: { label: "Stash", icon: STASH_ICON },
    destination: { label: "Kamino", icon: null },
  },
];

export function buildEarnTransactionDetail(
  item: EarnTransactionItem
): TransactionDetail {
  const isWithdraw = item.kind === "withdraw";
  const activity: ActivityRow = {
    id: item.id,
    type: isWithdraw ? "received" : "sent",
    counterparty: isWithdraw ? item.source.label : item.destination.label,
    amount: item.amount,
    timestamp: item.timestamp,
    date: item.dateGroup,
    icon: KAMINO_ICON,
  };
  return {
    activity,
    usdValue: `$${item.rawAmount}`,
    status: "Completed",
    networkFee: "~0.000005 SOL",
    networkFeeUsd: "~$0.0005",
  };
}

function CompoundIcon() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        flexShrink: 0,
        height: "48px",
        position: "relative",
        width: "48px",
      }}
    >
      <span
        style={{
          border: "2.286px solid #fff",
          borderRadius: "9999px",
          height: "32px",
          left: 0,
          overflow: "hidden",
          position: "absolute",
          top: 0,
          width: "32px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src="/wallet-workspace/earn-vault-usdc.png"
          style={{
            height: "100%",
            inset: 0,
            objectFit: "cover",
            position: "absolute",
            width: "100%",
          }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src="/wallet-workspace/earn-vault-usdc-overlay.png"
          style={{
            height: "100%",
            inset: 0,
            objectFit: "cover",
            position: "absolute",
            width: "100%",
          }}
        />
      </span>
      <span
        style={{
          borderRadius: "9999px",
          bottom: 0,
          height: "32px",
          overflow: "hidden",
          position: "absolute",
          right: 0,
          width: "32px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt=""
          src={KAMINO_ICON}
          style={{
            height: "100%",
            inset: 0,
            objectFit: "cover",
            position: "absolute",
            width: "100%",
          }}
        />
      </span>
    </span>
  );
}

function FlowAccount({
  label,
  icon,
}: {
  label: string;
  icon: string | null;
}) {
  return (
    <span
      style={{
        alignItems: "center",
        display: "inline-flex",
        gap: "4px",
        whiteSpace: "nowrap",
      }}
    >
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          aria-hidden="true"
          src={icon}
          style={{
            borderRadius: "4px",
            flexShrink: 0,
            height: "16px",
            objectFit: "cover",
            width: "16px",
          }}
        />
      ) : null}
      <span
        style={{
          color: secondary,
          fontFamily: font,
          fontSize: "13px",
          lineHeight: "16px",
        }}
      >
        {label}
      </span>
    </span>
  );
}

function EarnTransactionRow({
  item,
  onSelect,
}: {
  item: EarnTransactionItem;
  onSelect: (item: EarnTransactionItem) => void;
}) {
  const isWithdraw = item.kind === "withdraw";
  return (
    <button
      className="earn-tx-row"
      onClick={() => onSelect(item)}
      style={{
        alignItems: "center",
        background: "transparent",
        border: "none",
        borderRadius: "16px",
        cursor: "pointer",
        display: "flex",
        overflow: "hidden",
        padding: "0 12px",
        textAlign: "left",
        transition: "background 0.15s ease",
        width: "100%",
      }}
      type="button"
    >
      <span style={{ display: "flex", padding: "6px 12px 6px 0" }}>
        <CompoundIcon />
      </span>
      <span
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          gap: "2px",
          minWidth: 0,
          padding: "10px 0",
        }}
      >
        <span
          style={{
            color: "#000",
            fontFamily: font,
            fontSize: "16px",
            fontWeight: 500,
            letterSpacing: "-0.176px",
            lineHeight: "20px",
          }}
        >
          {isWithdraw ? "Withdraw" : "Deposit"}
        </span>
        <span
          style={{
            color: secondary,
            fontFamily: font,
            fontSize: "13px",
            lineHeight: "16px",
          }}
        >
          {item.timestamp}
        </span>
      </span>
      <span
        style={{
          alignItems: "flex-end",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
          paddingLeft: "12px",
          paddingTop: "10px",
          paddingBottom: "10px",
        }}
      >
        <span
          style={{
            color: isWithdraw ? "#34C759" : "#000",
            fontFamily: font,
            fontSize: "16px",
            lineHeight: "20px",
            whiteSpace: "nowrap",
          }}
        >
          {item.amount}
        </span>
        <span
          style={{
            alignItems: "center",
            display: "inline-flex",
            gap: "4px",
            justifyContent: "flex-end",
          }}
        >
          <FlowAccount icon={item.source.icon} label={item.source.label} />
          <span
            style={{
              color: "rgba(60, 60, 67, 0.4)",
              fontFamily: font,
              fontSize: "13px",
              lineHeight: "16px",
            }}
          >
            →
          </span>
          <FlowAccount
            icon={item.destination.icon}
            label={item.destination.label}
          />
        </span>
      </span>
    </button>
  );
}

export function EarnTransactionsPane({
  onSelectTransaction,
  topInset = 0,
}: {
  onSelectTransaction: (detail: TransactionDetail) => void;
  topInset?: number;
}) {
  const groups: { date: string; items: EarnTransactionItem[] }[] = [];
  for (const item of EARN_TRANSACTIONS) {
    const last = groups[groups.length - 1];
    if (last && last.date === item.dateGroup) {
      last.items.push(item);
    } else {
      groups.push({ date: item.dateGroup, items: [item] });
    }
  }

  const handleSelect = (item: EarnTransactionItem) => {
    onSelectTransaction(buildEarnTransactionDetail(item));
  };

  return (
    <div
      style={{
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        paddingTop: topInset,
        width: "100%",
      }}
    >
      <style jsx>{`
        .earn-tx-row:hover {
          background: rgba(0, 0, 0, 0.04) !important;
        }
        .earn-tx-row:focus-visible {
          outline: 2px solid rgba(249, 54, 60, 0.45);
          outline-offset: -2px;
        }
      `}</style>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          padding: "12px 20px 8px",
          width: "100%",
        }}
      >
        <h2
          style={{
            color: "#000",
            flex: 1,
            fontFamily: font,
            fontSize: "20px",
            fontWeight: 600,
            lineHeight: "28px",
            margin: 0,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          Transactions
        </h2>
      </div>

      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          minHeight: 0,
          overflowY: "auto",
          padding: "8px",
          scrollbarWidth: "none",
          width: "100%",
        }}
      >
        {groups.map((group) => (
          <div
            key={group.date}
            style={{ display: "flex", flexDirection: "column", width: "100%" }}
          >
            <div
              style={{
                padding: "11px 12px 8px",
                width: "100%",
              }}
            >
              <p
                style={{
                  color: secondary,
                  fontFamily: font,
                  fontSize: "16px",
                  fontWeight: 400,
                  letterSpacing: "-0.176px",
                  lineHeight: "20px",
                  margin: 0,
                }}
              >
                {group.date}
              </p>
            </div>
            {group.items.map((item) => (
              <EarnTransactionRow
                item={item}
                key={item.id}
                onSelect={handleSelect}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
