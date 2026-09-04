import { communityMembers, messages, users } from "@loyal-labs/db-core/schema";
import { eq } from "drizzle-orm";

import type { UserbotDb } from "../database";
import type { IngestibleMessage, PersistenceStats } from "./types";

type PersistEligibleMessageParams = {
  communityId: string;
  db: UserbotDb;
  membershipCache: Set<string>;
  message: IngestibleMessage;
  stats: PersistenceStats;
  userIdCache: Map<string, string>;
};

async function resolveOrCreateUserId(
  db: UserbotDb,
  userIdCache: Map<string, string>,
  message: IngestibleMessage,
  stats: PersistenceStats
): Promise<string> {
  const cacheKey = message.senderTelegramId.toString();
  const cachedUserId = userIdCache.get(cacheKey);
  if (cachedUserId) {
    return cachedUserId;
  }

  const insertedUser = await db
    .insert(users)
    .values({
      displayName: message.senderDisplayName,
      telegramId: message.senderTelegramId,
      username: message.senderUsername,
    })
    .onConflictDoNothing()
    .returning({ id: users.id });

  if (insertedUser.length > 0) {
    const userId = insertedUser[0].id;
    userIdCache.set(cacheKey, userId);
    stats.insertedUsers += 1;
    return userId;
  }

  const existingUser = await db.query.users.findFirst({
    columns: {
      displayName: true,
      id: true,
      username: true,
    },
    where: eq(users.telegramId, message.senderTelegramId),
  });

  if (!existingUser) {
    throw new Error(
      `Failed to resolve user ${message.senderTelegramId.toString()}`
    );
  }

  userIdCache.set(cacheKey, existingUser.id);

  if (
    existingUser.displayName !== message.senderDisplayName ||
    existingUser.username !== message.senderUsername
  ) {
    await db
      .update(users)
      .set({
        displayName: message.senderDisplayName,
        updatedAt: new Date(),
        username: message.senderUsername,
      })
      .where(eq(users.id, existingUser.id));
    stats.userMetadataUpdates += 1;
  }

  return existingUser.id;
}

async function ensureCommunityMembership(
  db: UserbotDb,
  membershipCache: Set<string>,
  communityId: string,
  userId: string,
  stats: PersistenceStats
): Promise<void> {
  const membershipKey = `${communityId}:${userId}`;
  if (membershipCache.has(membershipKey)) {
    return;
  }

  const insertedMembership = await db
    .insert(communityMembers)
    .values({
      communityId,
      userId,
    })
    .onConflictDoNothing()
    .returning({ id: communityMembers.id });

  membershipCache.add(membershipKey);
  if (insertedMembership.length > 0) {
    stats.insertedMemberships += 1;
  }
}

async function insertMessageRecord(
  db: UserbotDb,
  communityId: string,
  userId: string,
  message: IngestibleMessage,
  stats: PersistenceStats
): Promise<void> {
  const insertedMessage = await db
    .insert(messages)
    .values({
      communityId,
      content: message.content,
      createdAt: message.createdAt,
      telegramMessageId: BigInt(message.messageId),
      userId,
    })
    .onConflictDoNothing()
    .returning({ id: messages.id });

  if (insertedMessage.length > 0) {
    stats.insertedMessages += 1;
    return;
  }

  stats.duplicateMessages += 1;
}

export async function persistEligibleMessage(
  params: PersistEligibleMessageParams
): Promise<void> {
  const userId = await resolveOrCreateUserId(
    params.db,
    params.userIdCache,
    params.message,
    params.stats
  );

  await ensureCommunityMembership(
    params.db,
    params.membershipCache,
    params.communityId,
    userId,
    params.stats
  );

  await insertMessageRecord(
    params.db,
    params.communityId,
    userId,
    params.message,
    params.stats
  );
}
