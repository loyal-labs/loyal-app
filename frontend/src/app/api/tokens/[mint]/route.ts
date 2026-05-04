import { NextResponse } from "next/server";

import { fetchTokenDetailByMint } from "@/lib/market/token-detail.server";

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
    const detail = await fetchTokenDetailByMint(normalizedMint);
    return NextResponse.json(detail);
  } catch (error) {
    console.error("[api/tokens/[mint]] Failed to fetch token detail", error);
    return NextResponse.json(
      { error: "Failed to fetch token detail" },
      { status: 500 }
    );
  }
}
