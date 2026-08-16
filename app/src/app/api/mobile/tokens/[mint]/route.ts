import { NextResponse } from "next/server";

import {
  fetchTokenDetailByMint,
  parseMobileTokenDetailTimeframe,
} from "@/lib/market/token-detail.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ mint: string }> }
): Promise<NextResponse> {
  try {
    const { mint } = await context.params;
    const timeframe = parseMobileTokenDetailTimeframe(
      new URL(request.url).searchParams.get("timeframe")
    );
    const detail = await fetchTokenDetailByMint(mint, timeframe);

    return NextResponse.json(detail, { headers: corsHeaders });
  } catch (error) {
    console.error("[api/mobile/tokens/[mint]] Failed to fetch token detail", error);

    return NextResponse.json(
      { error: "Failed to fetch token detail" },
      { headers: corsHeaders, status: 500 }
    );
  }
}
