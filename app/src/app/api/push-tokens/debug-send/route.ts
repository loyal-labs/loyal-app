import { pushTokens } from "@loyal-labs/db-core/schema";
import { timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/core/config/server";
import { getDatabase } from "@/lib/core/database";
import { sendExpoPushNotifications } from "@/lib/push-notifications/send";

type DebugSendBody = {
  walletPublicKey?: unknown;
  title?: unknown;
  body?: unknown;
  data?: unknown;
};

export async function POST(request: Request): Promise<NextResponse> {
  let expectedToken: string;
  try {
    expectedToken = serverEnv.pushDebugSecret;
  } catch {
    console.error("PUSH_DEBUG_SECRET environment variable is not set");
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expected = Buffer.from(`Bearer ${expectedToken}`);
  const provided = Buffer.from(authHeader);
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: DebugSendBody;
  try {
    body = (await request.json()) as DebugSendBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const walletPublicKey =
    typeof body.walletPublicKey === "string" ? body.walletPublicKey : "";
  const title = typeof body.title === "string" ? body.title : "";
  const message = typeof body.body === "string" ? body.body : "";

  if (!walletPublicKey || !title || !message) {
    return NextResponse.json(
      { error: "walletPublicKey, title, and body are required" },
      { status: 400 },
    );
  }

  const data =
    body.data && typeof body.data === "object" && !Array.isArray(body.data)
      ? (body.data as Record<string, unknown>)
      : undefined;

  const db = getDatabase();
  const rows = await db
    .select({ token: pushTokens.token })
    .from(pushTokens)
    .where(eq(pushTokens.walletPublicKey, walletPublicKey));

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No push tokens registered for this wallet", sentTo: 0 },
      { status: 404 },
    );
  }

  await sendExpoPushNotifications(
    rows.map((row) => ({
      to: row.token,
      title,
      body: message,
      sound: "default",
      data,
    })),
  );

  return NextResponse.json({ success: true, sentTo: rows.length });
}
