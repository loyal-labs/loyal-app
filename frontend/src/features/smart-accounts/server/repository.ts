import "server-only";

import { and, asc, eq, inArray, lte } from "drizzle-orm";
import {
  appUserSmartAccounts,
  type AppUserSmartAccount,
  type AppUserSmartAccountSolanaEnv,
  type AppUserSmartAccountState,
} from "@loyal-labs/db-core/schema";

import { getDatabase } from "@/lib/core/database";

type SmartAccountRepositoryRecord = Pick<
  AppUserSmartAccount,
  | "id"
  | "userId"
  | "solanaEnv"
  | "settingsPda"
  | "state"
  | "creationSignature"
  | "lastCheckedAt"
  | "lastErrorCode"
  | "lastErrorMessage"
  | "createdAt"
  | "updatedAt"
>;

export type AppUserSmartAccountRecord = SmartAccountRepositoryRecord;

type AppUserSmartAccountRepositoryDependencies = {
  now: () => Date;
};

export class AppUserSmartAccountSettingsConflictError extends Error {
  constructor() {
    super("Smart account settings PDA is already reserved for this environment.");
    this.name = "AppUserSmartAccountSettingsConflictError";
  }
}

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

function createRepositoryDependencies(): AppUserSmartAccountRepositoryDependencies {
  return {
    now: () => new Date(),
  };
}

export async function findAppUserSmartAccountByUserIdAndEnv(
  userId: string,
  solanaEnv: AppUserSmartAccountSolanaEnv
): Promise<AppUserSmartAccountRecord | null> {
  const db = getDatabase();

  return (
    (await db.query.appUserSmartAccounts.findFirst({
      where: and(
        eq(appUserSmartAccounts.userId, userId),
        eq(appUserSmartAccounts.solanaEnv, solanaEnv)
      ),
    })) ?? null
  );
}

export async function listStaleAppUserSmartAccounts(args: {
  limit: number;
  staleBefore: Date;
  states?: AppUserSmartAccountState[];
}): Promise<AppUserSmartAccountRecord[]> {
  const db = getDatabase();

  return db.query.appUserSmartAccounts.findMany({
    where: and(
      inArray(
        appUserSmartAccounts.state,
        args.states ?? ["provisioning", "failed"]
      ),
      lte(appUserSmartAccounts.updatedAt, args.staleBefore)
    ),
    orderBy: asc(appUserSmartAccounts.updatedAt),
    limit: args.limit,
  });
}

export async function reserveProvisioningAppUserSmartAccount(
  input: {
    userId: string;
    solanaEnv: AppUserSmartAccountSolanaEnv;
    settingsPda: string;
  },
  dependencies: AppUserSmartAccountRepositoryDependencies = createRepositoryDependencies()
): Promise<AppUserSmartAccountRecord> {
  const db = getDatabase();
  const now = dependencies.now();

  try {
    const result = await db
      .insert(appUserSmartAccounts)
      .values({
        userId: input.userId,
        solanaEnv: input.solanaEnv,
        settingsPda: input.settingsPda,
        state: "provisioning",
        creationSignature: null,
        lastCheckedAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [appUserSmartAccounts.userId, appUserSmartAccounts.solanaEnv],
        set: {
          settingsPda: input.settingsPda,
          state: "provisioning",
          creationSignature: null,
          lastCheckedAt: now,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: now,
        },
      })
      .returning();

    if (!result[0]) {
      throw new Error("Failed to reserve app user smart account provisioning");
    }

    return result[0];
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppUserSmartAccountSettingsConflictError();
    }

    throw error;
  }
}

export async function markAppUserSmartAccountReady(
  input: {
    userId: string;
    solanaEnv: AppUserSmartAccountSolanaEnv;
    creationSignature?: string | null;
  },
  dependencies: AppUserSmartAccountRepositoryDependencies = createRepositoryDependencies()
): Promise<AppUserSmartAccountRecord> {
  const db = getDatabase();
  const now = dependencies.now();

  const result = await db
    .update(appUserSmartAccounts)
    .set({
      state: "ready",
      ...(input.creationSignature !== undefined
        ? { creationSignature: input.creationSignature }
        : {}),
      lastCheckedAt: now,
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(appUserSmartAccounts.userId, input.userId),
        eq(appUserSmartAccounts.solanaEnv, input.solanaEnv)
      )
    )
    .returning();

  if (!result[0]) {
    throw new Error("Failed to mark app user smart account ready");
  }

  return result[0];
}

export async function markAppUserSmartAccountFailed(
  input: {
    userId: string;
    solanaEnv: AppUserSmartAccountSolanaEnv;
    errorCode: string;
    errorMessage: string;
    creationSignature?: string | null;
  },
  dependencies: AppUserSmartAccountRepositoryDependencies = createRepositoryDependencies()
): Promise<AppUserSmartAccountRecord> {
  const db = getDatabase();
  const now = dependencies.now();

  const result = await db
    .update(appUserSmartAccounts)
    .set({
      state: "failed",
      ...(input.creationSignature !== undefined
        ? { creationSignature: input.creationSignature }
        : {}),
      lastCheckedAt: now,
      lastErrorCode: input.errorCode,
      lastErrorMessage: input.errorMessage,
      updatedAt: now,
    })
    .where(
      and(
        eq(appUserSmartAccounts.userId, input.userId),
        eq(appUserSmartAccounts.solanaEnv, input.solanaEnv)
      )
    )
    .returning();

  if (!result[0]) {
    throw new Error("Failed to mark app user smart account failed");
  }

  return result[0];
}
