import { trustedDapps } from "@loyal-labs/db-core/schema";
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/core/database";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
};

export type MobileTrustedDapp = {
  id: string;
  origin: string;
  name: string;
  startUrl: string;
  category: string | null;
  displayOrder: number;
};

export type MobileTrustedDappsResponse = {
  dapps: MobileTrustedDapp[];
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(): Promise<NextResponse> {
  try {
    const db = getDatabase();
    const rows = await db
      .select({
        id: trustedDapps.id,
        origin: trustedDapps.origin,
        name: trustedDapps.name,
        startUrl: trustedDapps.startUrl,
        category: trustedDapps.category,
        displayOrder: trustedDapps.displayOrder,
      })
      .from(trustedDapps)
      .where(eq(trustedDapps.isActive, true))
      .orderBy(asc(trustedDapps.displayOrder), asc(trustedDapps.name));

    const body: MobileTrustedDappsResponse = { dapps: rows };
    return NextResponse.json(body, { headers: corsHeaders });
  } catch (error) {
    console.error("[api/mobile/dapps] Failed to fetch trusted dapps", error);
    return NextResponse.json(
      { error: "Failed to fetch dapps" },
      { headers: corsHeaders, status: 500 }
    );
  }
}
