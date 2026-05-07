import "server-only";

import { and, eq } from "drizzle-orm";
import { appUserWallets, appUsers } from "@loyal-labs/db-core/schema";

import { getDatabase } from "@/lib/core/database";

export type CurrentUserPrincipal = {
  provider: "solana";
  authMethod: "wallet";
  subjectAddress: string;
  walletAddress: string;
};

export type AppUser = {
  id: string;
  provider: "solana";
  subjectAddress: string;
};

type AppUserDependencies = {
  now: () => Date;
  findUserByPrincipal: (
    principal: CurrentUserPrincipal
  ) => Promise<AppUser | null>;
  createUser: (
    principal: CurrentUserPrincipal,
    now: Date
  ) => Promise<AppUser | null>;
  updateUserMetadata: (
    user: AppUser,
    principal: CurrentUserPrincipal,
    now: Date
  ) => Promise<void>;
  upsertWalletForUser: (
    userId: string,
    walletAddress: string,
    now: Date
  ) => Promise<void>;
};

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const record = error as Error & { code?: string };
  return (
    record.code === "23505" ||
    /duplicate key|unique constraint/i.test(record.message)
  );
}

function mergeUserMetadata(user: AppUser): AppUser {
  return user;
}

function createAppUserDependencies(): AppUserDependencies {
  const db = getDatabase();

  return {
    now: () => new Date(),
    findUserByPrincipal: async (principal) =>
      (await db.query.appUsers.findFirst({
        columns: {
          id: true,
          provider: true,
          subjectAddress: true,
        },
        where: and(
          eq(appUsers.provider, principal.provider),
          eq(appUsers.subjectAddress, principal.subjectAddress)
        ),
      })) ?? null,
    createUser: async (principal, now) => {
      try {
        const result = await db
          .insert(appUsers)
          .values({
            provider: principal.provider,
            subjectAddress: principal.subjectAddress,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning({
            id: appUsers.id,
            provider: appUsers.provider,
            subjectAddress: appUsers.subjectAddress,
          });

        return result[0] ?? null;
      } catch (error) {
        if (isUniqueViolation(error)) {
          return null;
        }

        throw error;
      }
    },
    updateUserMetadata: async (user, _principal, now) => {
      await db
        .update(appUsers)
        .set({
          updatedAt: now,
        })
        .where(eq(appUsers.id, user.id));
    },
    upsertWalletForUser: async (userId, walletAddress, now) => {
      await db
        .insert(appUserWallets)
        .values({
          userId,
          walletAddress,
          verifiedAt: now,
          lastUsedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [appUserWallets.walletAddress],
          set: {
            userId,
            verifiedAt: now,
            lastUsedAt: now,
            updatedAt: now,
          },
        });
    },
  };
}

export async function findAppUserById(userId: string): Promise<AppUser | null> {
  const db = getDatabase();

  return (
    (await db.query.appUsers.findFirst({
      columns: {
        id: true,
        provider: true,
        subjectAddress: true,
      },
      where: eq(appUsers.id, userId),
    })) ?? null
  );
}

export async function getOrCreateCurrentUser(
  principal: CurrentUserPrincipal,
  dependencies: AppUserDependencies = createAppUserDependencies()
): Promise<AppUser> {
  const now = dependencies.now();
  const existingUser = await dependencies.findUserByPrincipal(principal);

  if (existingUser) {
    await dependencies.updateUserMetadata(existingUser, principal, now);
    await dependencies.upsertWalletForUser(
      existingUser.id,
      principal.walletAddress,
      now
    );
    return mergeUserMetadata(existingUser);
  }

  const createdUser = await dependencies.createUser(principal, now);
  if (createdUser) {
    await dependencies.upsertWalletForUser(
      createdUser.id,
      principal.walletAddress,
      now
    );
    return createdUser;
  }

  const racedUser = await dependencies.findUserByPrincipal(principal);
  if (!racedUser) {
    throw new Error("Failed to provision app user");
  }

  await dependencies.updateUserMetadata(racedUser, principal, now);
  await dependencies.upsertWalletForUser(racedUser.id, principal.walletAddress, now);
  return mergeUserMetadata(racedUser);
}
