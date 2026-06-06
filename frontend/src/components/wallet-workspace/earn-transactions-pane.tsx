"use client";

import { ReceiptText } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  ActivityRow,
  TransactionDetail,
} from "@/components/wallet-sidebar/types";
import { EarnYieldIcon } from "@/components/wallet-sidebar/portfolio-content";

const font = "var(--font-geist-sans), sans-serif";
const secondary = "rgba(60, 60, 67, 0.6)";

export type EarnTransactionItem = {
  id: string;
  kind: "deposit" | "withdraw";
  dateGroup: string;
  timestamp: string;
  amount: string;
  rawAmount: string;
  signature: string;
  confirmedSlot: string;
  source: { label: string; icon: string | null };
  destination: { label: string; icon: string | null };
};

type EarnTransactionsRouteResponse = {
  transactions: EarnTransactionItem[];
};

type EarnTransactionsRouteErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

const KAMINO_ICON = "/wallet-workspace/earn-kamino.png";
const EARN_VAULT_LABEL = "Earn vault";

export function buildEarnTransactionDetail(
  item: EarnTransactionItem
): TransactionDetail {
  const isWithdraw = item.kind === "withdraw";
  const activity: ActivityRow = {
    id: item.signature,
    type: isWithdraw ? "received" : "sent",
    counterparty: isWithdraw ? item.source.label : item.destination.label,
    amount: item.amount,
    timestamp: item.timestamp,
    date: item.dateGroup,
    icon: KAMINO_ICON,
  };
  return {
    activity,
    usdValue: item.rawAmount,
    status: "Completed",
    networkFee: "~0.000005 SOL",
    networkFeeUsd: "~$0.0005",
  };
}

function EarnTransactionsLoadingState() {
  return (
    <div
      aria-label="Loading earn transactions"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "8px 12px",
      }}
    >
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          style={{
            alignItems: "center",
            display: "flex",
            gap: "12px",
            height: "60px",
            width: "100%",
          }}
        >
          <span
            style={{
              background: "rgba(0, 0, 0, 0.06)",
              borderRadius: "9999px",
              height: "48px",
              width: "48px",
            }}
          />
          <span
            style={{
              display: "flex",
              flex: 1,
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <span
              style={{
                background: "rgba(0, 0, 0, 0.06)",
                borderRadius: "9999px",
                height: "14px",
                width: "104px",
              }}
            />
            <span
              style={{
                background: "rgba(0, 0, 0, 0.05)",
                borderRadius: "9999px",
                height: "12px",
                width: "72px",
              }}
            />
          </span>
          <span
            style={{
              background: "rgba(0, 0, 0, 0.06)",
              borderRadius: "9999px",
              height: "14px",
              width: "92px",
            }}
          />
        </div>
      ))}
    </div>
  );
}

function EarnTransactionsErrorState({ message }: { message: string }) {
  return (
    <div
      role="status"
      style={{
        alignItems: "center",
        display: "flex",
        flex: 1,
        flexDirection: "column",
        justifyContent: "center",
        minHeight: "220px",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <span
        style={{
          color: "#000",
          fontFamily: font,
          fontSize: "16px",
          fontWeight: 500,
          lineHeight: "20px",
        }}
      >
        Transactions unavailable
      </span>
      <span
        style={{
          color: secondary,
          fontFamily: font,
          fontSize: "13px",
          fontWeight: 400,
          lineHeight: "16px",
          marginTop: "4px",
          maxWidth: "240px",
        }}
      >
        {message}
      </span>
    </div>
  );
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

function FlowAccount({ label, icon }: { label: string; icon: string | null }) {
  return (
    <span
      style={{
        alignItems: "center",
        display: "inline-flex",
        gap: "4px",
        whiteSpace: "nowrap",
      }}
    >
      {label === EARN_VAULT_LABEL ? (
        <EarnYieldIcon size={16} />
      ) : icon ? (
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

function EarnTransactionsEmptyState() {
  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        flex: 1,
        flexDirection: "column",
        justifyContent: "center",
        minHeight: "220px",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: "rgba(0, 0, 0, 0.04)",
          borderRadius: "9999px",
          color: "rgba(60, 60, 67, 0.58)",
          display: "flex",
          height: "48px",
          justifyContent: "center",
          marginBottom: "12px",
          width: "48px",
        }}
      >
        <ReceiptText size={22} strokeWidth={1.8} />
      </div>
      <span
        style={{
          color: "#000",
          fontFamily: font,
          fontSize: "16px",
          fontWeight: 500,
          lineHeight: "20px",
        }}
      >
        No transactions yet
      </span>
      <span
        style={{
          color: secondary,
          fontFamily: font,
          fontSize: "13px",
          fontWeight: 400,
          lineHeight: "16px",
          marginTop: "4px",
          maxWidth: "220px",
        }}
      >
        Earn deposits and withdrawals will appear here.
      </span>
    </div>
  );
}

function groupEarnTransactions(items: EarnTransactionItem[]) {
  const groups: { date: string; items: EarnTransactionItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === item.dateGroup) {
      last.items.push(item);
    } else {
      groups.push({ date: item.dateGroup, items: [item] });
    }
  }
  return groups;
}

export function EarnTransactionsPane({
  onSelectTransaction,
  topInset = 0,
}: {
  onSelectTransaction: (detail: TransactionDetail) => void;
  topInset?: number;
}) {
  const [transactions, setTransactions] = useState<EarnTransactionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadTransactions = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      const response = await fetch("/api/smart-accounts/earn-transactions", {
        credentials: "include",
      });

      if (!response.ok) {
        const errorPayload = (await response
          .json()
          .catch(() => null)) as EarnTransactionsRouteErrorResponse | null;
        console.warn("[earn-transactions] API error", {
          error: errorPayload?.error ?? null,
          status: response.status,
          statusText: response.statusText,
        });
        const message =
          errorPayload?.error?.message ?? "Failed to load earn transactions.";
        throw new Error(message);
      }

      const payload = (await response.json()) as EarnTransactionsRouteResponse;

      if (isMounted) {
        setTransactions(payload.transactions);
        setErrorMessage(null);
      }
    };

    void loadTransactions()
      .catch((error) => {
        console.warn("[earn-transactions] failed to load transactions", error);
        if (isMounted) {
          setTransactions([]);
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Failed to load earn transactions."
          );
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const groups = groupEarnTransactions(transactions);

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
        {isLoading ? (
          <EarnTransactionsLoadingState />
        ) : errorMessage ? (
          <EarnTransactionsErrorState message={errorMessage} />
        ) : transactions.length === 0 ? (
          <EarnTransactionsEmptyState />
        ) : (
          groups.map((group) => (
            <div
              key={group.date}
              style={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
              }}
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
          ))
        )}
      </div>
    </div>
  );
}
