import { NextResponse } from "next/server";

import { getFrontendFlagsManifest } from "@/lib/flags/get-frontend-flags-manifest";

export async function GET() {
  const payload = await getFrontendFlagsManifest();
  return NextResponse.json(payload);
}
