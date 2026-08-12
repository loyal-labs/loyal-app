import { users, userSettings } from "@loyal-labs/db-core/schema";
import { eq } from "drizzle-orm";

import { getDatabase } from "@/lib/core/database";
import { captureTelegramProfilePhotoToCdn } from "@/lib/telegram/profile-photo-service";

type KnownUser = {
  id: string;
  hasAvatar: boolean;
};

// Cache of known users (telegramId string -> user metadata)
const knownUsers = new Map<string, KnownUser>();
// In-flight dedupe for get/create operations (telegramId string -> Promise<userUUID>)
const inFlightUsers = new Map<string, Promise<string>>();
// In-flight dedupe for avatar backfills (telegramId string -> Promise<didUpdate>)
const inFlightAvatarBackfills = new Map<string, Promise<boolean>>();

async function backfillUserAvatar(
  telegramId: bigint,
  userId: string
): Promise<boolean> {
  const telegramIdStr = String(telegramId);
  const pendingBackfill = inFlightAvatarBackfills.get(telegramIdStr);
  if (pendingBackfill) {
    return pendingBackfill;
  }

  const backfillPromise = (async () => {
    const avatarUrl = await captureTelegramProfilePhotoToCdn(telegramId);

    if (!avatarUrl) {
      return false;
    }

    const db = getDatabase();
    await db
      .update(users)
      .set({
        avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    knownUsers.set(telegramIdStr, {
      id: userId,
      hasAvatar: true,
    });

    return true;
  })().finally(() => {
    inFlightAvatarBackfills.delete(telegramIdStr);
  });

  inFlightAvatarBackfills.set(telegramIdStr, backfillPromise);
  return backfillPromise;
}

async function ensureUserSettingsForUserId(userId: string): Promise<void> {
  const db = getDatabase();
  await db.insert(userSettings).values({ userId }).onConflictDoNothing();
}

async function resolveOrCreateUser(
  telegramId: bigint,
  userData: {
    username: string | null;
    displayName: string;
  },
  options: {
    backfillAvatar: boolean;
  }
): Promise<string> {
  const telegramIdStr = String(telegramId);
  const db = getDatabase();

  const existingUser = await db.query.users.findFirst({
    where: eq(users.telegramId, telegramId),
  });

  if (existingUser) {
    await ensureUserSettingsForUserId(existingUser.id);

    const hasAvatar = Boolean(existingUser.avatarUrl);
    knownUsers.set(telegramIdStr, {
      id: existingUser.id,
      hasAvatar,
    });

    if (!hasAvatar && options.backfillAvatar) {
      await backfillUserAvatar(telegramId, existingUser.id);
    }

    return existingUser.id;
  }

  const insertedUser = await db
    .insert(users)
    .values({
      telegramId,
      username: userData.username,
      displayName: userData.displayName,
    })
    .onConflictDoNothing()
    .returning({
      id: users.id,
      avatarUrl: users.avatarUrl,
    });

  const userRecord =
    insertedUser[0] ??
    (await db.query.users.findFirst({
      where: eq(users.telegramId, telegramId),
      columns: {
        id: true,
        avatarUrl: true,
      },
    }));

  if (!userRecord) {
    throw new Error(`Failed to resolve user ${telegramIdStr} after conflict`);
  }

  await ensureUserSettingsForUserId(userRecord.id);

  const hasAvatar = Boolean(userRecord.avatarUrl);
  knownUsers.set(telegramIdStr, {
    id: userRecord.id,
    hasAvatar,
  });

  if (!hasAvatar && options.backfillAvatar) {
    await backfillUserAvatar(telegramId, userRecord.id);
  }

  return userRecord.id;
}

/**
 * Gets or creates a user by their Telegram ID.
 * Uses in-memory caches to reduce duplicate DB/network work.
 * Returns the user's UUID.
 */
export async function getOrCreateUser(
  telegramId: bigint,
  userData: {
    username: string | null;
    displayName: string;
  },
  options?: {
    backfillAvatar?: boolean;
  }
): Promise<string> {
  const telegramIdStr = String(telegramId);
  const cachedUser = knownUsers.get(telegramIdStr);
  const shouldBackfillAvatar = options?.backfillAvatar ?? true;

  if (cachedUser) {
    if (!cachedUser.hasAvatar && shouldBackfillAvatar) {
      await backfillUserAvatar(telegramId, cachedUser.id);
    }
    return cachedUser.id;
  }

  const pendingUser = inFlightUsers.get(telegramIdStr);
  if (pendingUser) {
    return pendingUser;
  }

  const resolvePromise = resolveOrCreateUser(telegramId, userData, {
    backfillAvatar: shouldBackfillAvatar,
  }).finally(() => {
    inFlightUsers.delete(telegramIdStr);
  });

  inFlightUsers.set(telegramIdStr, resolvePromise);
  return resolvePromise;
}
