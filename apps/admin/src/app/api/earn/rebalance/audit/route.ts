import { NextResponse } from "next/server";

import {
  decodeRebalanceAuditCursor,
  getRebalanceAuditActivePage,
  getRebalanceAuditPage,
  getRebalanceAuditSummary,
  type RebalanceAuditErrorFilter,
  type RebalanceAuditRange,
  type RebalanceRouteMode,
  type RebalanceAuditView,
} from "../../../../(admin)/earn/rebalance/rebalance-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const views = new Set<RebalanceAuditView>([
  "completed_rebalances",
  "completed_deposits",
  "errors",
]);
const ranges = new Set<RebalanceAuditRange>(["24h", "7d", "30d", "all"]);
const routeModes = new Set<RebalanceRouteMode>(["same_mint", "cross_mint"]);
const errorFilters = new Set<RebalanceAuditErrorFilter>([
  "all",
  "rebalance",
  "deposit",
  "needs_review",
]);

function parseEnum<T extends string>(
  value: string | null,
  allowed: ReadonlySet<T>,
  fallback: T
): T | null {
  if (!value) {
    return fallback;
  }

  return allowed.has(value as T) ? (value as T) : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const view = parseEnum(url.searchParams.get("view"), views, "errors");
  const range = parseEnum(url.searchParams.get("range"), ranges, "24h");
  const routeMode = parseEnum(
    url.searchParams.get("routeMode"),
    routeModes,
    "same_mint"
  );
  const errorFilter = parseEnum(
    url.searchParams.get("errorFilter"),
    errorFilters,
    "all"
  );
  const rawCursor = url.searchParams.get("cursor");
  const cursor = decodeRebalanceAuditCursor(rawCursor);
  const rawActiveCursor = url.searchParams.get("activeCursor");
  const activeCursor = decodeRebalanceAuditCursor(rawActiveCursor);

  if (
    !view ||
    !range ||
    !routeMode ||
    !errorFilter ||
    (rawCursor && !cursor) ||
    (rawActiveCursor && !activeCursor)
  ) {
    return NextResponse.json(
      { error: "Invalid rebalance audit query." },
      { status: 400 }
    );
  }

  const [summary, page, activePage] = await Promise.all([
    getRebalanceAuditSummary(range, routeMode),
    getRebalanceAuditPage({
      cursor,
      errorFilter,
      range,
      routeMode,
      view,
    }),
    getRebalanceAuditActivePage({
      cursor: activeCursor,
      range,
      routeMode,
    }),
  ]);

  const serializePage = (auditPage: typeof page) => ({
    ...auditPage,
    rows: auditPage.rows.map((row) => ({
      ...row,
      amountRaw: row.amountRaw?.toString() ?? null,
      confirmedSlot: row.confirmedSlot?.toString() ?? null,
      submittedSlot: row.submittedSlot?.toString() ?? null,
    })),
  });

  return NextResponse.json(
    {
      activePage: serializePage(activePage),
      generatedAt: new Date().toISOString(),
      page: serializePage(page),
      summary,
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    }
  );
}
