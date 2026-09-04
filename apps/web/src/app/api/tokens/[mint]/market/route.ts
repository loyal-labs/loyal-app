import { NextResponse } from "next/server";

import {
  fetchTokenMarketByMint,
  isLikelySolanaMint,
  TOKEN_DETAIL_RESPONSE_CACHE_CONTROL,
} from "@/lib/market/token-detail.server";

const CACHE_HEADERS = {
  "Cache-Control": TOKEN_DETAIL_RESPONSE_CACHE_CONTROL,
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mint: string }> }
) {
  const { mint } = await params;
  const normalizedMint = mint?.trim();

  if (!normalizedMint || !isLikelySolanaMint(normalizedMint)) {
    // Deterministic per-URL, so let the CDN absorb repeated invalid-mint spam.
    return NextResponse.json(
      { error: "Invalid token mint" },
      { headers: CACHE_HEADERS, status: 400 }
    );
  }

  try {
    const market = await fetchTokenMarketByMint(normalizedMint);
    return NextResponse.json(market, { headers: CACHE_HEADERS });
  } catch (error) {
    console.error(
      "[api/tokens/[mint]/market] Failed to fetch token market",
      error
    );
    return NextResponse.json(
      { error: "Failed to fetch token market" },
      { status: 500 }
    );
  }
}
