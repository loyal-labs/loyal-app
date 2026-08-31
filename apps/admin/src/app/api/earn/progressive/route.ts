import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/require-admin-session";

import { getEarnFundingData } from "../../../(admin)/earn/earn-funding-data";
import { getEarnStablecoinMonitoring } from "../../../(admin)/earn/earn-stablecoin-monitoring";
import { getAdminEarnSnapshot } from "../../../(admin)/earn/earn-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function serialize(value: unknown) {
  return JSON.parse(
    JSON.stringify(value, (_key, nestedValue: unknown) =>
      typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
    )
  );
}

export async function GET(request: Request) {
  await requireAdminSession();

  const searchParams = new URL(request.url).searchParams;
  const section = searchParams.get("section");

  if (section === "monitoring") {
    const [{ data, rows }, snapshot] = await Promise.all([
      getEarnStablecoinMonitoring(),
      getAdminEarnSnapshot(),
    ]);
    return NextResponse.json(
      {
        data: serialize(data),
        rows: serialize(rows),
        snapshot: serialize(snapshot),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }

  if (section === "funding") {
    const data = await getEarnFundingData();
    return NextResponse.json(
      { data: serialize(data) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }

  return NextResponse.json(
    { error: "section must be monitoring or funding" },
    { status: 400, headers: { "Cache-Control": "private, no-store" } }
  );
}
