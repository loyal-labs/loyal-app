import { NextResponse } from "next/server";

import {
  TOKEN_MARKETS_RESPONSE_CACHE_CONTROL,
  fetchTokenMarketsByMints,
} from "@/lib/market/token-markets.server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mintsParam = url.searchParams.get("mints");

  if (!mintsParam) {
    return NextResponse.json(
      { error: "mints query parameter is required" },
      { status: 400 }
    );
  }

  const mints = mintsParam
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (mints.length === 0) {
    return NextResponse.json(
      { markets: [] },
      {
        headers: {
          "Cache-Control": TOKEN_MARKETS_RESPONSE_CACHE_CONTROL,
        },
      }
    );
  }

  try {
    const markets = await fetchTokenMarketsByMints(mints);
    return NextResponse.json(
      { markets },
      {
        headers: {
          "Cache-Control": TOKEN_MARKETS_RESPONSE_CACHE_CONTROL,
        },
      }
    );
  } catch (error) {
    console.error("[api/tokens/markets] failed to fetch markets", error);
    return NextResponse.json(
      { error: "Failed to fetch token markets" },
      { status: 500 }
    );
  }
}
