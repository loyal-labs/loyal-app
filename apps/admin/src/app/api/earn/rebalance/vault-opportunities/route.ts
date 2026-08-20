import { NextResponse } from "next/server";

import {
  getEarnVaultOpportunityCounts,
  type RebalanceRouteMode,
} from "../../../../(admin)/earn/rebalance/rebalance-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const routeModes = new Set<RebalanceRouteMode>(["same_mint", "cross_mint"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const vaultId = url.searchParams.get("vaultId") ?? "";
  const routeMode = url.searchParams.get("routeMode") ?? "";

  if (
    !/^\d+$/.test(vaultId) ||
    !routeModes.has(routeMode as RebalanceRouteMode)
  ) {
    return NextResponse.json(
      { error: "Invalid vault opportunity query." },
      { status: 400 }
    );
  }

  const counts = await getEarnVaultOpportunityCounts(
    vaultId,
    routeMode as RebalanceRouteMode
  );

  if (!counts) {
    return NextResponse.json(
      { error: "Active Earn vault not found." },
      { status: 404 }
    );
  }

  return NextResponse.json(counts, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
