import { NextResponse } from "next/server";

import { fetchTokenMarketByMint } from "@/lib/market/token-detail.server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mint: string }> }
) {
  const { mint } = await params;
  const normalizedMint = mint?.trim();

  if (!normalizedMint) {
    return NextResponse.json(
      { error: "Token mint is required" },
      { status: 400 }
    );
  }

  try {
    const market = await fetchTokenMarketByMint(normalizedMint);
    return NextResponse.json(market);
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
