import { NextResponse } from "next/server";

import { getEarnStablecoinByMint } from "@/lib/earn/stablecoin-monitor.shared";
import { requireAdminSession } from "@/lib/require-admin-session";

import {
  getEarnVaultRebalanceFrequency,
  getExecutedEarnRebalanceHistory,
} from "../../../../(admin)/earn/rebalance/rebalance-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  await requireAdminSession();

  const searchParams = new URL(request.url).searchParams;
  const kind = searchParams.get("kind");
  const liquidityMint = searchParams.get("liquidityMint");

  if (
    liquidityMint !== null &&
    getEarnStablecoinByMint(liquidityMint) === null
  ) {
    return NextResponse.json(
      { error: "Invalid stablecoin mint." },
      { status: 400 }
    );
  }

  const matchesStablecoin = (row: {
    liquidityMint: string | null;
    routeMode: "cross_mint" | "same_mint";
  }) =>
    liquidityMint === null ||
    row.routeMode === "cross_mint" ||
    row.liquidityMint === liquidityMint;

  if (kind === "executed") {
    const history = await getExecutedEarnRebalanceHistory();
    return NextResponse.json(
      {
        details: history.details.filter(matchesStablecoin).map((execution) => ({
          ...execution,
          amountRaw: execution.amountRaw.toString(),
          confirmedSlot: execution.confirmedSlot.toString(),
          currentDepositRaw: execution.currentDepositRaw.toString(),
          swapFeeLamports: execution.swapFeeLamports.toString(),
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }

  if (kind === "frequency") {
    const frequency = await getEarnVaultRebalanceFrequency();
    return NextResponse.json(
      {
        details: frequency.details.filter(matchesStablecoin).map((vault) => ({
          ...vault,
          currentDepositRaw: vault.currentDepositRaw.toString(),
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }

  return NextResponse.json(
    { error: "Invalid rebalance detail kind." },
    { status: 400 }
  );
}
