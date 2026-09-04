import { userSettings } from "@loyal-labs/db-core/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/core/database";
import {
  cleanInitData,
  createValidationBytesFromRawInitData,
} from "@/lib/telegram/mini-app/init-data-transform";
import { verifyInitData } from "@/lib/telegram/mini-app/verify-init-data";
import { getOrCreateUser } from "@/lib/telegram/user-service";

function extractUser(rawInitData: string): {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
} {
  const cleanData = cleanInitData(rawInitData);
  return JSON.parse(cleanData.user as string);
}

async function authenticateAndGetUserId(
  rawInitData: string
): Promise<
  { userId: string; error?: never } | { userId?: never; error: NextResponse }
> {
  let validationBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    ({ validationBytes, signatureBytes } =
      createValidationBytesFromRawInitData(rawInitData));
  } catch {
    return {
      error: NextResponse.json(
        { error: "Invalid initData payload" },
        { status: 400 }
      ),
    };
  }

  const isValid = await verifyInitData(validationBytes, signatureBytes);
  if (!isValid) {
    return {
      error: NextResponse.json(
        { error: "Invalid Telegram init data" },
        { status: 401 }
      ),
    };
  }

  const user = extractUser(rawInitData);
  const displayName = user.last_name
    ? `${user.first_name} ${user.last_name}`
    : user.first_name;

  const userId = await getOrCreateUser(BigInt(user.id), {
    username: user.username || null,
    displayName,
  });

  return { userId };
}

/** GET – return current user settings */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawInitData = url.searchParams.get("initData");
    if (!rawInitData) {
      return NextResponse.json(
        { error: "initData is required" },
        { status: 400 }
      );
    }

    const auth = await authenticateAndGetUserId(rawInitData);
    if (auth.error) return auth.error;

    const db = getDatabase();
    const inserted = await db
      .insert(userSettings)
      .values({ userId: auth.userId })
      .onConflictDoNothing()
      .returning();

    const settings =
      inserted[0] ??
      (await db.query.userSettings.findFirst({
        where: eq(userSettings.userId, auth.userId),
      }));

    if (!settings) {
      return NextResponse.json(
        { error: "Failed to load settings" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      notifications: settings.notifications,
      model: settings.model,
    });
  } catch (error) {
    console.error("[telegram][settings] GET failed", error);
    return NextResponse.json(
      { error: "Failed to load settings" },
      { status: 500 }
    );
  }
}

/** PATCH – update a user setting */
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { rawInitData, notifications } = body;

    if (!rawInitData) {
      return NextResponse.json(
        { error: "rawInitData is required" },
        { status: 400 }
      );
    }

    if (typeof notifications !== "boolean") {
      return NextResponse.json(
        { error: "notifications (boolean) is required" },
        { status: 400 }
      );
    }

    const auth = await authenticateAndGetUserId(rawInitData);
    if (auth.error) return auth.error;

    const db = getDatabase();
    const [updated] = await db
      .insert(userSettings)
      .values({ userId: auth.userId, notifications, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { notifications, updatedAt: new Date() },
      })
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "Failed to update settings" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      notifications: updated.notifications,
      model: updated.model,
    });
  } catch (error) {
    console.error("[telegram][settings] PATCH failed", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
