import { NextResponse } from "next/server";

import { fetchTokenDetailByMint } from "@/lib/market/token-detail.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ mint: string }> }
): Promise<NextResponse> {
  try {
    const { mint } = await context.params;
    const detail = await fetchTokenDetailByMint(mint);

    return NextResponse.json(detail, { headers: corsHeaders });
  } catch (error) {
    console.error("[api/mobile/tokens/[mint]] Failed to fetch token detail", error);

    return NextResponse.json(
      { error: "Failed to fetch token detail" },
      { headers: corsHeaders, status: 500 }
    );
  }
}
