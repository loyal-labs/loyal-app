import { useState } from "react";

import { ActivityRowItem } from "~/src/components/wallet/activity-row-item";
import { SearchInput, SubViewHeader } from "~/src/components/wallet/shared";
import type {
  ActivityRow,
  SubView,
  TransactionDetail,
} from "@loyal-labs/wallet-core/types";

export function AllActivityView({
  activities,
  details,
  isBalanceHidden,
  onBack,
  onClose,
  onNavigate,
}: {
  activities: ActivityRow[];
  details: Record<string, TransactionDetail>;
  isBalanceHidden: boolean;
  onBack: () => void;
  onClose: () => void;
  onNavigate: (view: SubView) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = activities.filter(
    (a) =>
      a.counterparty.toLowerCase().includes(search.toLowerCase()) ||
      a.amount.toLowerCase().includes(search.toLowerCase()) ||
      a.type.toLowerCase().includes(search.toLowerCase()),
  );

  // Group by date
  const grouped: { date: string; items: ActivityRow[] }[] = [];
  for (const item of filtered) {
    const existing = grouped.find((g) => g.date === item.date);
    if (existing) {
      existing.items.push(item);
    } else {
      grouped.push({ date: item.date, items: [item] });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <SubViewHeader onBack={onBack} onClose={onClose} title="Activity" />
      <SearchInput onChange={setSearch} value={search} />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "0 8px",
        }}
      >
        {grouped.map((group) => (
          <div key={group.date}>
            {/* Date header */}
            <div style={{ padding: "12px 12px 8px" }}>
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
                {group.date}
              </span>
            </div>
            {group.items.map((activity) => (
              <ActivityRowItem
                activity={{ ...activity, timestamp: activity.timestamp }}
                isBalanceHidden={isBalanceHidden}
                key={activity.id}
                onClick={() =>
                  onNavigate({
                    type: "transaction",
                    detail: details[activity.id],
                    from: "allActivity",
                  })
                }
              />
            ))}
          </div>
        ))}
        {grouped.length === 0 && (
          <div
            style={{
              padding: "32px 20px",
              textAlign: "center",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: "14px",
              color: "rgba(60, 60, 67, 0.6)",
            }}
          >
            No activity found
          </div>
        )}
      </div>
    </div>
  );
}
