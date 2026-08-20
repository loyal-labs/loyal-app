import { NextResponse } from "next/server";

import {
  getEarnVaultRebalanceFrequency,
  getExecutedEarnRebalanceHistory,
} from "../../../../(admin)/earn/rebalance/rebalance-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind");

  if (kind === "executed") {
    const history = await getExecutedEarnRebalanceHistory();
    return NextResponse.json(
      {
        details: history.details.map((execution) => ({
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
        details: frequency.details.map((vault) => ({
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
