import { NextResponse } from "next/server";

import {
  fetchTokenChartByMint,
  fetchTokenDetailByMint,
  isLikelySolanaMint,
  TOKEN_CHART_DAYS,
  TOKEN_DETAIL_RESPONSE_CACHE_CONTROL,
  type TokenChartDays,
} from "@/lib/market/token-detail.server";

const CACHE_HEADERS = {
  "Cache-Control": TOKEN_DETAIL_RESPONSE_CACHE_CONTROL,
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mint: string }> }
) {
  const { mint } = await params;
  const normalizedMint = mint?.trim();

  if (!normalizedMint || !isLikelySolanaMint(normalizedMint)) {
    return NextResponse.json(
      { error: "Invalid token mint" },
      { headers: CACHE_HEADERS, status: 400 }
    );
  }

  const chartDays = new URL(request.url).searchParams.get("chartDays");

  try {
    // ?chartDays=<1|7|30|365|max> returns just that range's chart points; the
    // plain request keeps returning the full detail (with the 24h chart).
    if (chartDays) {
      if (!TOKEN_CHART_DAYS.includes(chartDays as TokenChartDays)) {
        return NextResponse.json(
          { error: "Invalid chartDays" },
          { headers: CACHE_HEADERS, status: 400 }
        );
      }
      const chart = await fetchTokenChartByMint(
        normalizedMint,
        chartDays as TokenChartDays
      );
      return NextResponse.json({ chart }, { headers: CACHE_HEADERS });
    }

    const detail = await fetchTokenDetailByMint(normalizedMint);
    return NextResponse.json(detail, { headers: CACHE_HEADERS });
  } catch (error) {
    console.error("[api/tokens/[mint]] Failed to fetch token detail", error);
    return NextResponse.json(
      { error: "Failed to fetch token detail" },
      { status: 500 }
    );
  }
}
